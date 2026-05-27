import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { documents, type DocumentStatus } from "../db/schema.ts";
import type { Env, ExtractWorkflowParams } from "../env.ts";
import { extractTR1, GEMINI_MODEL } from "../lib/gemini.ts";
import {
  REVIEW_RULES_VERSION,
  countReviewFields,
  enrichTR1List,
} from "../lib/review-rules.ts";
import { sendDocument, sendMessage } from "../lib/telegram.ts";
import {
  PROMPT_VERSION,
  type TR1Enriched,
  type TR1EnrichedList,
  type TR1Extracted,
} from "../lib/tr1-schema.ts";

const HEAVY_STEP: WorkflowStepConfig = {
  retries: { limit: 2, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

const LIGHT_STEP: WorkflowStepConfig = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
  timeout: "1 minute",
};

interface LoadedDoc {
  id: string;
  chatId: string;
  messageId: number;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  r2Key: string;
}

export class ExtractDocumentWorkflow extends WorkflowEntrypoint<
  Env,
  ExtractWorkflowParams
> {
  async run(event: WorkflowEvent<ExtractWorkflowParams>, step: WorkflowStep) {
    const { documentId } = event.payload;
    const d = db(this.env);
    const now = () => Math.floor(Date.now() / 1000);

    const loaded: LoadedDoc = await step.do("load", LIGHT_STEP, async () => {
      const rows = await d
        .select({
          id: documents.id,
          chatId: documents.chatId,
          messageId: documents.messageId,
          fileName: documents.fileName,
          mimeType: documents.mimeType,
          fileSize: documents.fileSize,
          r2Key: documents.r2Key,
        })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error(`document ${documentId} not found`);

      await d
        .update(documents)
        .set({
          status: "processing" satisfies DocumentStatus,
          workflowInstanceId: event.instanceId,
          startedAt: now(),
        })
        .where(eq(documents.id, documentId));

      return row;
    });

    await step.do("extract", HEAVY_STEP, async () => {
      const object = await this.env.DOCS.get(loaded.r2Key);
      if (!object) throw new Error(`r2 object ${loaded.r2Key} not found`);
      const bytes = await object.arrayBuffer();

      const result = await extractTR1(this.env, {
        fileBytes: bytes,
        mimeType: loaded.mimeType ?? "application/pdf",
      });

      await d
        .update(documents)
        .set({
          rawGeminiResponse: result.raw as object,
          geminiModel: result.model,
          promptVersion: result.promptVersion,
          tokenUsage: result.usage as unknown as object,
          extractionCount: result.extractions.length,
        })
        .where(eq(documents.id, documentId));

      return { ok: true as const };
    });

    const enrichedList: TR1EnrichedList = await step.do(
      "persist",
      LIGHT_STEP,
      async () => {
        const rows = await d
          .select({ raw: documents.rawGeminiResponse })
          .from(documents)
          .where(eq(documents.id, documentId))
          .limit(1);
        const rawWrap = rows[0]?.raw as
          | { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
          | undefined;
        const text = rawWrap?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("raw_gemini_response missing candidate text on persist replay");
        }
        const parsed = JSON.parse(text) as { extractions: TR1Extracted[] };
        const enriched = enrichTR1List(parsed.extractions);
        const payload: TR1EnrichedList = {
          extraction_count: enriched.length,
          extractions: enriched,
        };

        await d
          .update(documents)
          .set({
            extractedData: payload as unknown as object,
            reviewRulesVersion: REVIEW_RULES_VERSION,
            status: "completed" satisfies DocumentStatus,
            completedAt: now(),
          })
          .where(eq(documents.id, documentId));

        return payload;
      },
    );

    await step.do("notify", LIGHT_STEP, async () => {
      const rows = await d
        .select({
          summarySentAt: documents.summarySentAt,
          fileSentAt: documents.fileSentAt,
        })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);
      const flags = rows[0] ?? { summarySentAt: null, fileSentAt: null };

      if (!flags.summarySentAt) {
        await sendMessage(this.env, {
          chatId: loaded.chatId,
          text: renderSummary(enrichedList),
          replyToMessageId: loaded.messageId,
        });
        await d
          .update(documents)
          .set({ summarySentAt: now() })
          .where(eq(documents.id, documentId));
      }

      if (!flags.fileSentAt) {
        const jsonBytes = new TextEncoder().encode(
          JSON.stringify(enrichedList, null, 2),
        );
        const baseName = (loaded.fileName ?? "tr1").replace(/\.[^.]+$/, "");
        await sendDocument(this.env, {
          chatId: loaded.chatId,
          fileBytes: jsonBytes,
          fileName: `${baseName}-extracted.json`,
          mimeType: "application/json",
          replyToMessageId: loaded.messageId,
        });
        await d
          .update(documents)
          .set({ fileSentAt: now() })
          .where(eq(documents.id, documentId));
      }
    });
  }
}

function renderSummary(list: TR1EnrichedList): string {
  const n = list.extraction_count;
  const totalReview = list.extractions.reduce(
    (acc, e) => acc + countReviewFields(e),
    0,
  );

  const header = n === 1
    ? "✅ <b>Extraction complete</b>"
    : `✅ <b>Extraction complete — ${n} TR1 forms found</b>`;

  const blocks = list.extractions.map((e, i) =>
    renderOneTr1(e, n > 1 ? i + 1 : null, n),
  );

  const footer = [
    `<b>Prompt:</b> ${PROMPT_VERSION} · <b>Model:</b> ${GEMINI_MODEL} · <b>Rules:</b> ${REVIEW_RULES_VERSION}`,
    totalReview > 0
      ? `⚠️ ${totalReview} field(s) flagged for review across all forms`
      : "✅ all fields confident",
    "",
    "Full JSON attached below.",
  ].join("\n");

  return [header, "", ...blocks, footer].join("\n");
}

function renderOneTr1(
  e: TR1Enriched,
  ordinal: number | null,
  totalCount: number,
): string {
  const title = e.title_number.value ?? "<i>unknown</i>";
  const property = e.property.value ?? "<i>unknown</i>";
  const date = e.date.value ?? "<i>unknown</i>";
  const consideration =
    e.consideration_money.value ?? e.consideration_other.value ?? "<i>none</i>";
  const reviewCount = countReviewFields(e);

  const heading = ordinal
    ? `<b>TR1 ${ordinal} of ${totalCount}</b>`
    : "<b>TR1 details</b>";

  const reviewLine =
    reviewCount > 0
      ? `⚠️ ${reviewCount} field(s) need review`
      : "✅ all fields confident";

  return [
    heading,
    `<b>Title:</b> ${escapeHtml(title)}`,
    `<b>Property:</b> ${escapeHtml(property)}`,
    `<b>Date:</b> ${escapeHtml(date)}`,
    `<b>Consideration:</b> ${escapeHtml(consideration)}`,
    reviewLine,
    "",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

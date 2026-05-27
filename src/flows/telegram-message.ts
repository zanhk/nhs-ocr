import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { documents } from "../db/schema.ts";
import type { Env } from "../env.ts";
import {
  downloadFile,
  getFile,
  pickLargestPhoto,
  sendMessage,
  type TelegramMessage,
} from "../lib/telegram.ts";

const MAX_TELEGRAM_FILE_BYTES = 20 * 1024 * 1024;

interface Attachment {
  fileId: string;
  fileUniqueId: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

function extractAttachment(msg: TelegramMessage): Attachment | null {
  if (msg.document) {
    return {
      fileId: msg.document.file_id,
      fileUniqueId: msg.document.file_unique_id,
      fileName: msg.document.file_name ?? null,
      mimeType: msg.document.mime_type ?? null,
      fileSize: msg.document.file_size ?? null,
    };
  }
  if (msg.photo && msg.photo.length > 0) {
    const largest = pickLargestPhoto(msg.photo);
    return {
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      fileName: null,
      mimeType: "image/jpeg",
      fileSize: largest.file_size ?? null,
    };
  }
  return null;
}

function extFromMime(mime: string | null, fallback = "bin"): string {
  if (!mime) return fallback;
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  return fallback;
}

function isSupportedMime(mime: string | null): boolean {
  if (!mime) return false;
  if (mime === "application/pdf") return true;
  if (mime.startsWith("image/")) return true;
  return false;
}

export async function handleTelegramMessage(
  env: Env,
  msg: TelegramMessage,
): Promise<void> {
  const chatId = String(msg.chat.id);
  const userId = msg.from ? String(msg.from.id) : "0";

  const attachment = extractAttachment(msg);
  if (!attachment) {
    if (msg.text?.startsWith("/start") || msg.text?.startsWith("/help")) {
      await sendMessage(env, {
        chatId,
        text: [
          "👋 <b>NHS-OCR</b> — Land Registry TR1 extractor.",
          "",
          "Send me a TR1 PDF or photo and I'll reply with the extracted fields as JSON.",
          "",
          "Supported: PDF, JPEG, PNG, WebP, HEIC. Max 20 MB.",
        ].join("\n"),
        replyToMessageId: msg.message_id,
      });
    }
    return;
  }

  if (attachment.fileSize && attachment.fileSize > MAX_TELEGRAM_FILE_BYTES) {
    await sendMessage(env, {
      chatId,
      text: "❌ File is over 20 MB — Telegram bot downloads don't support files that large. Please re-upload a smaller version.",
      replyToMessageId: msg.message_id,
    });
    return;
  }

  if (attachment.mimeType && !isSupportedMime(attachment.mimeType)) {
    await sendMessage(env, {
      chatId,
      text: `❌ Unsupported file type <code>${attachment.mimeType}</code>. Send a PDF or an image.`,
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const d = db(env);
  const existing = await d
    .select({ id: documents.id, status: documents.status })
    .from(documents)
    .where(
      and(
        eq(documents.chatId, chatId),
        eq(documents.telegramFileUniqueId, attachment.fileUniqueId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await sendMessage(env, {
      chatId,
      text: `ℹ️ I've already seen this file (ID <code>${existing[0].id}</code>, status: <code>${existing[0].status}</code>). Skipping.`,
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const meta = await getFile(env, attachment.fileId);
  if (!meta.file_path) {
    await sendMessage(env, {
      chatId,
      text: "❌ Telegram didn't return a download path for that file (it may be over 20 MB or unavailable).",
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const { bytes, etag } = await downloadFile(env, meta.file_path);
  const mime =
    attachment.mimeType ??
    (meta.file_path.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const ext = extFromMime(mime, "bin");
  const documentId = crypto.randomUUID();
  const r2Key = `documents/${documentId}.${ext}`;

  const r2Object = await env.DOCS.put(r2Key, bytes, {
    httpMetadata: { contentType: mime },
  });

  await d.insert(documents).values({
    id: documentId,
    chatId,
    userId,
    messageId: msg.message_id,
    telegramFileId: attachment.fileId,
    telegramFileUniqueId: attachment.fileUniqueId,
    fileName: attachment.fileName,
    mimeType: mime,
    fileSize: attachment.fileSize ?? bytes.byteLength,
    r2Key,
    r2Etag: r2Object?.etag ?? etag,
    status: "pending",
  });

  await env.EXTRACT_WORKFLOW.create({
    id: documentId,
    params: { documentId },
  });

  await sendMessage(env, {
    chatId,
    text: "📄 Processing your document… this usually takes 30–60 seconds.",
    replyToMessageId: msg.message_id,
  });
}

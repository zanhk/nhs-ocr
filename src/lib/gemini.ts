import type { Env } from "../env.ts";
import {
  PROMPT_VERSION,
  TR1_PROMPT,
  TR1_RESPONSE_SCHEMA,
  type TR1Extracted,
} from "./tr1-schema.ts";

export const GEMINI_MODEL = "gemini-3.5-flash";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
}

export interface ExtractResult {
  parsed: TR1Extracted;
  raw: unknown;
  usage: TokenUsage;
  model: string;
  promptVersion: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    safetyRatings?: unknown[];
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

export async function extractTR1(
  env: Env,
  args: { fileBytes: ArrayBuffer; mimeType: string },
): Promise<ExtractResult> {
  const body = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: args.mimeType,
              data: bytesToBase64(args.fileBytes),
            },
          },
          { text: TR1_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: TR1_RESPONSE_SCHEMA,
      temperature: 0,
    },
  };

  const res = await fetch(`${ENDPOINT}?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`gemini ${GEMINI_MODEL} failed ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as GeminiResponse;

  if (json.promptFeedback?.blockReason) {
    throw new Error(`gemini blocked: ${json.promptFeedback.blockReason}`);
  }

  const candidate = json.candidates?.[0];
  if (!candidate) {
    throw new Error(`gemini returned no candidates: ${JSON.stringify(json).slice(0, 500)}`);
  }
  if (candidate.finishReason === "SAFETY") {
    throw new Error("gemini blocked by safety filters (finishReason=SAFETY)");
  }
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`gemini finishReason=${candidate.finishReason}`);
  }

  const text = candidate.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(
      `gemini candidate has no text part: ${JSON.stringify(candidate).slice(0, 500)}`,
    );
  }

  let parsed: TR1Extracted;
  try {
    parsed = JSON.parse(text) as TR1Extracted;
  } catch (err) {
    throw new Error(
      `gemini returned non-JSON despite responseMimeType=application/json: ${(err as Error).message}. Text: ${text.slice(0, 500)}`,
    );
  }

  const usage: TokenUsage = {
    input: json.usageMetadata?.promptTokenCount ?? 0,
    output: json.usageMetadata?.candidatesTokenCount ?? 0,
    cached: json.usageMetadata?.cachedContentTokenCount,
  };

  return {
    parsed,
    raw: json,
    usage,
    model: GEMINI_MODEL,
    promptVersion: PROMPT_VERSION,
  };
}

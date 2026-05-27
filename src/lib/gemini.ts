import type { Env } from "../env.ts";
import {
  PROMPT_VERSION,
  TR1_FIELD_NAMES,
  TR1_FIELD_REQUIRED_KEYS,
  TR1_PROMPT,
  TR1_RESPONSE_SCHEMA,
  type TR1Extracted,
  type TR1FieldName,
} from "./tr1-schema.ts";

export const GEMINI_MODEL = "gemini-3.5-flash";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
}

export interface ExtractResult {
  extractions: TR1Extracted[];
  raw: unknown;
  usage: TokenUsage;
  model: string;
  promptVersion: string;
  healingApplied: string[];
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

const KEY_TYPO_FIXES: Record<string, string> = {
  vaue: "value",
  valu: "value",
  vlue: "value",
};

function bytesToBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function healFieldObject(
  raw: Record<string, unknown>,
  extractionIndex: number,
  fieldName: TR1FieldName,
  healingLog: string[],
): Record<string, unknown> {
  const healed: Record<string, unknown> = { ...raw };

  for (const [bad, good] of Object.entries(KEY_TYPO_FIXES)) {
    if (bad in healed && !(good in healed)) {
      healed[good] = healed[bad];
      delete healed[bad];
      healingLog.push(`extraction[${extractionIndex}].${fieldName}: '${bad}' → '${good}'`);
    }
  }

  for (const req of TR1_FIELD_REQUIRED_KEYS) {
    if (!(req in healed)) {
      throw new Error(
        `gemini schema drift: extraction[${extractionIndex}].${fieldName} is missing required key '${req}'. Got keys: [${Object.keys(raw).join(", ")}]`,
      );
    }
  }

  return healed;
}

function validateAndHeal(
  parsed: unknown,
): { extractions: TR1Extracted[]; healingLog: string[] } {
  if (!isPlainObject(parsed)) {
    throw new Error(
      `gemini did not return an object. Got: ${typeof parsed}`,
    );
  }
  const arr = (parsed as { extractions?: unknown }).extractions;
  if (!Array.isArray(arr)) {
    throw new Error(
      `gemini response missing 'extractions' array. Got keys: [${Object.keys(parsed).join(", ")}]`,
    );
  }

  const healingLog: string[] = [];
  const out: TR1Extracted[] = [];

  arr.forEach((rawExtraction, i) => {
    if (!isPlainObject(rawExtraction)) {
      throw new Error(
        `gemini extractions[${i}] is not an object`,
      );
    }
    const healedExtraction: Record<string, unknown> = {};
    for (const fieldName of TR1_FIELD_NAMES) {
      const rawField = rawExtraction[fieldName];
      if (!isPlainObject(rawField)) {
        throw new Error(
          `gemini extractions[${i}] missing or malformed field '${fieldName}'`,
        );
      }
      healedExtraction[fieldName] = healFieldObject(
        rawField,
        i,
        fieldName,
        healingLog,
      );
    }
    out.push(healedExtraction as unknown as TR1Extracted);
  });

  return { extractions: out, healingLog };
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

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `gemini returned non-JSON despite responseMimeType=application/json: ${(err as Error).message}. Text: ${text.slice(0, 500)}`,
    );
  }

  const { extractions, healingLog } = validateAndHeal(parsedRaw);

  if (healingLog.length > 0) {
    console.warn(`gemini schema healing applied (${healingLog.length}): ${healingLog.join("; ")}`);
  }

  if (extractions.length === 0) {
    throw new Error(
      "no TR1 forms detected in this file — make sure you uploaded a UK Land Registry TR1 document",
    );
  }

  const usage: TokenUsage = {
    input: json.usageMetadata?.promptTokenCount ?? 0,
    output: json.usageMetadata?.candidatesTokenCount ?? 0,
    cached: json.usageMetadata?.cachedContentTokenCount,
  };

  return {
    extractions,
    raw: json,
    usage,
    model: GEMINI_MODEL,
    promptVersion: PROMPT_VERSION,
    healingApplied: healingLog,
  };
}

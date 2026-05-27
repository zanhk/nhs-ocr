import type { ExtractDocumentWorkflow } from "./workflows/extract-document.ts";

export interface ExtractWorkflowParams {
  documentId: string;
}

export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  EXTRACT_WORKFLOW: Workflow<ExtractWorkflowParams>;

  TELEGRAM_ALLOWED_CHAT_IDS: string;

  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GEMINI_API_KEY: string;
}

export type { ExtractDocumentWorkflow };

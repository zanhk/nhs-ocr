import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type DocumentStatus = "pending" | "processing" | "completed" | "failed";

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    workflowInstanceId: text("workflow_instance_id"),

    chatId: text("chat_id").notNull(),
    userId: text("user_id").notNull(),
    messageId: integer("message_id").notNull(),

    telegramFileId: text("telegram_file_id").notNull(),
    telegramFileUniqueId: text("telegram_file_unique_id").notNull(),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),

    r2Key: text("r2_key").notNull(),
    r2Etag: text("r2_etag"),

    status: text("status", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),

    extractedData: text("extracted_data", { mode: "json" }),
    rawGeminiResponse: text("raw_gemini_response", { mode: "json" }),

    geminiModel: text("gemini_model"),
    promptVersion: text("prompt_version"),
    reviewRulesVersion: text("review_rules_version"),
    tokenUsage: text("token_usage", { mode: "json" }),

    attemptCount: integer("attempt_count").notNull().default(0),
    errorMessage: text("error_message"),

    summarySentAt: integer("summary_sent_at"),
    fileSentAt: integer("file_sent_at"),

    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
  },
  (t) => ({
    uniqChatFile: uniqueIndex("documents_chat_file_uniq").on(
      t.chatId,
      t.telegramFileUniqueId,
    ),
    statusCreatedIdx: index("documents_status_created_idx").on(
      t.status,
      t.createdAt,
    ),
    chatCreatedIdx: index("documents_chat_created_idx").on(
      t.chatId,
      t.createdAt,
    ),
  }),
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

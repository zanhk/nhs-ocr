CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_instance_id` text,
	`chat_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message_id` integer NOT NULL,
	`telegram_file_id` text NOT NULL,
	`telegram_file_unique_id` text NOT NULL,
	`file_name` text,
	`mime_type` text,
	`file_size` integer,
	`r2_key` text NOT NULL,
	`r2_etag` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`extracted_data` text,
	`raw_gemini_response` text,
	`gemini_model` text,
	`prompt_version` text,
	`review_rules_version` text,
	`token_usage` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`summary_sent_at` integer,
	`file_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_chat_file_uniq` ON `documents` (`chat_id`,`telegram_file_unique_id`);--> statement-breakpoint
CREATE INDEX `documents_status_created_idx` ON `documents` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `documents_chat_created_idx` ON `documents` (`chat_id`,`created_at`);
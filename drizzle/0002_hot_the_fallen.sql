CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`conversation_id` text NOT NULL,
	`project_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`assistant_msg_id` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_agent_runs_project_status` ON `agent_runs` (`project_id`,`status`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `status` text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE `image_chat_messages` ADD `status` text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE `styleguide_chat_messages` ADD `status` text DEFAULT 'complete' NOT NULL;
CREATE TABLE `asset_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`text` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text NOT NULL,
	`description` text DEFAULT '',
	`prompt` text,
	`negative_prompt` text,
	`seed` integer,
	`workflow_id` text,
	`workflow_name` text,
	`generation_tool` text NOT NULL,
	`generation_params` text,
	`executed_workflow_json` text,
	`source_asset_ids` text,
	`source_clip_id` text,
	`duration` real,
	`width` integer,
	`height` integer,
	`file_size` integer,
	`tags` text DEFAULT '[]',
	`favorite` integer DEFAULT 0,
	`on_timeline` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`thinking` text,
	`tool_calls` text,
	`segments` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`order` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text DEFAULT '',
	`order` integer DEFAULT 0 NOT NULL,
	`layout` text DEFAULT '{}' NOT NULL,
	`plain_prompt` text DEFAULT '',
	`negative_prompt` text DEFAULT '',
	`status` text DEFAULT 'draft' NOT NULL,
	`asset_id` text,
	`file_path` text,
	`seed` integer,
	`gen_width` integer,
	`gen_height` integer,
	`workflow_id` text,
	`last_error` text,
	`executed_workflow_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_images_project_order` ON `images` (`project_id`,`order`);--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`args` text DEFAULT '[]',
	`env` text DEFAULT '{}',
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plugin_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_styleguides` (
	`project_id` text NOT NULL,
	`styleguide_id` text NOT NULL,
	`attached_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `styleguide_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`styleguide_id`) REFERENCES `styleguides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`folder_id` text,
	`aspect_ratio` text DEFAULT '1:1' NOT NULL,
	`megapixels` real DEFAULT 1 NOT NULL,
	`width` integer DEFAULT 1024 NOT NULL,
	`height` integer DEFAULT 1024 NOT NULL,
	`default_workflow_id` text,
	`prompt_format` text DEFAULT 'ideogram' NOT NULL,
	`disabled_tool_buckets` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styleguide_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`styleguide_id` text NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text,
	`file_size` integer,
	`role` text NOT NULL,
	`label` text DEFAULT '',
	`order` integer DEFAULT 0,
	`created_at` text NOT NULL,
	FOREIGN KEY (`styleguide_id`) REFERENCES `styleguides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `styleguide_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`styleguide_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`thinking` text,
	`tool_calls` text,
	`segments` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`styleguide_id`) REFERENCES `styleguides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `styleguides` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`markdown` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `undo_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`group_id` text NOT NULL,
	`group_label` text NOT NULL,
	`seq` integer NOT NULL,
	`tool_name` text NOT NULL,
	`source` text NOT NULL,
	`before_state` text NOT NULL,
	`after_state` text NOT NULL,
	`file_backups` text,
	`files_created` text,
	`undone` integer DEFAULT 0,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text DEFAULT 'comfyui' NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`workflow_type` text NOT NULL,
	`workflow_json` text,
	`prompt_node_id` text,
	`output_node_id` text,
	`image_input_node_id` text,
	`end_image_input_node_id` text,
	`audio_input_node_id` text,
	`voice_input_node_id` text,
	`default_voice_file` text,
	`default_cfg` real,
	`postfix` text DEFAULT '',
	`override_base_url` text,
	`trim_end_frames` integer DEFAULT 0,
	`is_default` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

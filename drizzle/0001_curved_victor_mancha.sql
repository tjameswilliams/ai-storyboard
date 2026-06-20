CREATE TABLE `image_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`image_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`thinking` text,
	`tool_calls` text,
	`segments` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_image_chat_messages_image` ON `image_chat_messages` (`image_id`);
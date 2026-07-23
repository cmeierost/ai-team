ALTER TABLE `sessions` ADD `active_session_id` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `thread_navigation_stack_json` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `thread_last_active_at` text;

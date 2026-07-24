ALTER TABLE `messages` ADD `llm_duration_ms` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_time_to_first_token_ms` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_provider_duration_ms` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_prompt_tokens` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_completion_tokens` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_total_tokens` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_model` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_provider` text;

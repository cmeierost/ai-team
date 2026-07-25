CREATE TABLE `workflow_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `definition_id` text NOT NULL,
  `definition_version` text NOT NULL,
  `status` text NOT NULL,
  `input_json` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `snapshot_sequence` integer DEFAULT 0 NOT NULL,
  `root_session_id` text,
  `active_session_id` text,
  `output_json` text,
  `failure_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `completed_at` text,
  `cancelled_at` text
);
--> statement-breakpoint
CREATE INDEX `workflow_runs_active_session_idx` ON `workflow_runs` (`active_session_id`);

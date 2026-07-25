CREATE TABLE `workflow_operations` (
  `run_id` text NOT NULL,
  `operation_key` text NOT NULL,
  `status` text NOT NULL,
  `input_json` text NOT NULL,
  `output_json` text,
  `failure_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY(`run_id`, `operation_key`)
);

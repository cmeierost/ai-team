ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message';
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN failure_id TEXT;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN error_code TEXT;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN error_details_json TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_failure_id
  ON messages(failure_id)
  WHERE failure_id IS NOT NULL;

ALTER TABLE message_tool_calls ADD COLUMN tool_call_id TEXT;
--> statement-breakpoint
ALTER TABLE message_tool_calls ADD COLUMN requested_at TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS message_tool_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_tool_call_id INTEGER NOT NULL,
  phase TEXT NOT NULL,
  result_json TEXT,
  result_llm TEXT,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (message_tool_call_id) REFERENCES message_tool_calls(id) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO message_tool_results (
  message_tool_call_id,
  phase,
  result_json,
  result_llm,
  completed_at
)
SELECT
  calls.id,
  CASE
    WHEN json_extract(calls.result_json, '$.status') = 'error' THEN 'error'
    WHEN json_extract(calls.result_json, '$.status') = 'denied' THEN 'denied'
    ELSE 'result'
  END,
  calls.result_json,
  calls.result_llm,
  messages.timestamp
FROM message_tool_calls AS calls
INNER JOIN messages ON messages.id = calls.message_id
WHERE calls.result_json IS NOT NULL OR calls.result_llm IS NOT NULL;
--> statement-breakpoint
UPDATE message_tool_calls
SET
  tool_call_id = 'legacy-' || id,
  requested_at = (
    SELECT messages.timestamp
    FROM messages
    WHERE messages.id = message_tool_calls.message_id
  )
WHERE tool_call_id IS NULL OR requested_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_message_tool_calls_call_id
  ON message_tool_calls(tool_call_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_message_tool_results_call
  ON message_tool_results(message_tool_call_id, completed_at);

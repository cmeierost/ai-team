CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  notes TEXT,
  previous_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS session_agents (
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (session_id, agent_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT,
  is_human INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  hidden_from_llm INTEGER NOT NULL DEFAULT 0,
  handoff_type TEXT,
  target_agent_id TEXT,
  handoff_from_session_id TEXT,
  handoff_to_session_id TEXT,
  handoff_id TEXT,
  importance TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS message_files (
  message_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  PRIMARY KEY (message_id, file_path),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS message_tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  params_json TEXT NOT NULL,
  result_json TEXT,
  result_llm TEXT,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS message_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  suggestion_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_number INTEGER,
  description TEXT NOT NULL,
  code TEXT,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS session_artifacts (
  session_id TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  PRIMARY KEY (session_id, artifact_path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS session_files (
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  is_prioritized INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, file_path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS session_merged_from (
  session_id TEXT NOT NULL,
  merged_session_id TEXT NOT NULL,
  PRIMARY KEY (session_id, merged_session_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS session_rag_config (
  session_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS session_skills (
  session_id TEXT NOT NULL,
  skill_path TEXT NOT NULL,
  loaded_at TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, skill_path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  title TEXT,
  content TEXT NOT NULL,
  tags_json TEXT,
  attachment_name TEXT,
  attachment_path TEXT,
  attachment_content_type TEXT,
  attachment_size_bytes INTEGER,
  attachment_description TEXT,
  compacted_content TEXT,
  hidden_from_llm INTEGER NOT NULL DEFAULT 0,
  show_on_dashboard INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS note_attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS note_session_shares (
  note_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  anchor_message_id INTEGER,
  kind TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  from_message_id INTEGER,
  to_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (note_id, session_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS message_session_links (
  message_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, session_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS planning_intake_items (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_url TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS planning_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_type TEXT NOT NULL,
  assigned_to TEXT,
  origin_type TEXT NOT NULL,
  origin_session_id TEXT,
  origin_note_id TEXT,
  markdown_snapshot TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS planning_plan_intake_items (
  plan_id TEXT NOT NULL,
  intake_item_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, intake_item_id),
  FOREIGN KEY (plan_id) REFERENCES planning_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (intake_item_id) REFERENCES planning_intake_items(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS planning_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_type TEXT NOT NULL,
  assigned_to TEXT,
  source_action_item TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES planning_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS planning_todos (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  content TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES planning_tasks(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS planning_task_delegations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  reason TEXT,
  delegated_at TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  accepted_at TEXT,
  FOREIGN KEY (task_id) REFERENCES planning_tasks(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  from_id UNINDEXED,
  session_id UNINDEXED,
  message_id UNINDEXED
);
--> statement-breakpoint

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  content,
  agent_id UNINDEXED,
  note_id UNINDEXED
);
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(content, from_id, session_id, message_id)
  VALUES (new.content, new.from_id, new.session_id, new.id);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  UPDATE messages_fts
    SET content = new.content,
        from_id = new.from_id,
        session_id = new.session_id
    WHERE message_id = old.id;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(title, content, agent_id, note_id)
  VALUES (new.title, new.content, new.agent_id, new.id);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE note_id = old.id;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  UPDATE notes_fts
    SET title = new.title,
        content = new.content,
        agent_id = new.agent_id
    WHERE note_id = old.id;
END;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp ON messages(session_id, timestamp);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_from_id ON messages(from_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_to_id ON messages(to_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_handoff_id ON messages(handoff_id) WHERE handoff_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_importance ON messages(importance) WHERE importance IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_hidden_from_llm ON messages(hidden_from_llm);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_sessions_developer ON sessions(developer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_session_agents_agent ON session_agents(agent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_session_skills_session ON session_skills(session_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_notes_agent ON notes(agent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id, sort_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_note_session_shares_note ON note_session_shares(note_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_note_session_shares_session ON note_session_shares(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_note_session_shares_anchor ON note_session_shares(session_id, active, anchor_message_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_message_session_links_session ON message_session_links(session_id);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_intake_source ON planning_intake_items(source_type, source_ref);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_planning_intake_status ON planning_intake_items(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_planning_plans_status ON planning_plans(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_planning_plans_assigned_to ON planning_plans(assigned_to);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_planning_tasks_plan_id ON planning_tasks(plan_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_planning_tasks_session_id ON planning_tasks(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_planning_tasks_assigned_to ON planning_tasks(assigned_to);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_planning_todos_task_id ON planning_todos(task_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_planning_task_delegations_task_id ON planning_task_delegations(task_id);
--> statement-breakpoint

INSERT INTO messages_fts(content, from_id, session_id, message_id)
  SELECT content, from_id, session_id, id
  FROM messages
  WHERE NOT EXISTS (SELECT 1 FROM messages_fts WHERE message_id = messages.id);
--> statement-breakpoint

INSERT INTO notes_fts(title, content, agent_id, note_id)
  SELECT title, content, agent_id, id
  FROM notes
  WHERE NOT EXISTS (SELECT 1 FROM notes_fts WHERE note_id = notes.id);
--> statement-breakpoint

INSERT OR REPLACE INTO schema_version(version, applied_at)
VALUES (1, datetime('now'));

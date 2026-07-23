import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const schemaVersion = sqliteTable('schema_version', {
  version: integer('version').primaryKey(),
  appliedAt: text('applied_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  developerId: text('developer_id').notNull(),
  startedAt: text('started_at').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
  messageCount: integer('message_count').notNull().default(0),
  title: text('title'),
  notes: text('notes'),
  previousSessionId: text('previous_session_id'),
  activeSessionId: text('active_session_id'),
  threadNavigationStackJson: text('thread_navigation_stack_json'),
  threadLastActiveAt: text('thread_last_active_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessionAgents = sqliteTable('session_agents', {
  sessionId: text('session_id').notNull(),
  agentId: text('agent_id').notNull(),
});

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  timestamp: text('timestamp').notNull(),
  fromId: text('from_id').notNull(),
  toId: text('to_id'),
  isHuman: integer('is_human').notNull().default(0),
  content: text('content').notNull(),
  archived: integer('archived').notNull().default(0),
  hiddenFromLlm: integer('hidden_from_llm').notNull().default(0),
  handoffType: text('handoff_type'),
  targetAgentId: text('target_agent_id'),
  handoffFromSessionId: text('handoff_from_session_id'),
  handoffToSessionId: text('handoff_to_session_id'),
  handoffId: text('handoff_id'),
  importance: text('importance'),
});

export const messageFiles = sqliteTable('message_files', {
  messageId: integer('message_id').notNull(),
  filePath: text('file_path').notNull(),
});

export const messageToolCalls = sqliteTable('message_tool_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').notNull(),
  toolName: text('tool_name').notNull(),
  paramsJson: text('params_json').notNull(),
  resultJson: text('result_json'),
  resultLlm: text('result_llm'),
});

export const messageSuggestions = sqliteTable('message_suggestions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').notNull(),
  suggestionType: text('suggestion_type').notNull(),
  filePath: text('file_path').notNull(),
  lineNumber: integer('line_number'),
  description: text('description').notNull(),
  code: text('code'),
});

export const sessionArtifacts = sqliteTable('session_artifacts', {
  sessionId: text('session_id').notNull(),
  artifactPath: text('artifact_path').notNull(),
});

export const sessionFiles = sqliteTable('session_files', {
  sessionId: text('session_id').notNull(),
  filePath: text('file_path').notNull(),
  isPrioritized: integer('is_prioritized').notNull().default(0),
});

export const sessionMergedFrom = sqliteTable('session_merged_from', {
  sessionId: text('session_id').notNull(),
  mergedSessionId: text('merged_session_id').notNull(),
});

export const sessionRagConfig = sqliteTable('session_rag_config', {
  sessionId: text('session_id').primaryKey(),
  configJson: text('config_json').notNull(),
});

export const sessionSkills = sqliteTable('session_skills', {
  sessionId: text('session_id').notNull(),
  skillPath: text('skill_path').notNull(),
  loadedAt: text('loaded_at').notNull(),
  paused: integer('paused').notNull().default(0),
});

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  sessionId: text('session_id'),
  title: text('title'),
  content: text('content').notNull(),
  tagsJson: text('tags_json'),
  attachmentName: text('attachment_name'),
  attachmentPath: text('attachment_path'),
  attachmentContentType: text('attachment_content_type'),
  attachmentSizeBytes: integer('attachment_size_bytes'),
  attachmentDescription: text('attachment_description'),
  compactedContent: text('compacted_content'),
  hiddenFromLlm: integer('hidden_from_llm').notNull().default(0),
  showOnDashboard: integer('show_on_dashboard').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const noteAttachments = sqliteTable('note_attachments', {
  id: text('id').primaryKey(),
  noteId: text('note_id').notNull(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const noteSessionShares = sqliteTable('note_session_shares', {
  noteId: text('note_id').notNull(),
  sessionId: text('session_id').notNull(),
  anchorMessageId: integer('anchor_message_id'),
  kind: text('kind'),
  active: integer('active').notNull().default(1),
  fromMessageId: integer('from_message_id'),
  toMessageId: integer('to_message_id'),
  createdAt: text('created_at').notNull(),
});

export const messageSessionLinks = sqliteTable('message_session_links', {
  messageId: integer('message_id').notNull(),
  sessionId: text('session_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const planningIntakeItems = sqliteTable('planning_intake_items', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(),
  sourceRef: text('source_ref').notNull(),
  sourceUrl: text('source_url'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const planningPlans = sqliteTable('planning_plans', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  goal: text('goal'),
  status: text('status').notNull(),
  priority: text('priority').notNull(),
  createdBy: text('created_by').notNull(),
  createdByType: text('created_by_type').notNull(),
  assignedTo: text('assigned_to'),
  originType: text('origin_type').notNull(),
  originSessionId: text('origin_session_id'),
  originNoteId: text('origin_note_id'),
  markdownSnapshot: text('markdown_snapshot'),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const planningPlanIntakeItems = sqliteTable('planning_plan_intake_items', {
  planId: text('plan_id').notNull(),
  intakeItemId: text('intake_item_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const planningTasks = sqliteTable('planning_tasks', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  sessionId: text('session_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  type: text('type').notNull(),
  status: text('status').notNull(),
  priority: text('priority').notNull(),
  createdBy: text('created_by').notNull(),
  createdByType: text('created_by_type').notNull(),
  assignedTo: text('assigned_to'),
  sourceActionItem: text('source_action_item'),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const planningTodos = sqliteTable('planning_todos', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  content: text('content').notNull(),
  orderIndex: integer('order_index').notNull(),
  done: integer('done').notNull().default(0),
  completedAt: text('completed_at'),
  completedBy: text('completed_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const planningTaskDelegations = sqliteTable('planning_task_delegations', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  reason: text('reason'),
  delegatedAt: text('delegated_at').notNull(),
  accepted: integer('accepted').notNull().default(0),
  acceptedAt: text('accepted_at'),
});

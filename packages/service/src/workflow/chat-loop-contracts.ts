import { z } from 'zod';

/**
 * Canonical workflow IDs for the first chat-loop composition.
 */
export const chatWorkflowIdSchema = z.enum([
  'chat-full-loop',
  'chat-preturn-interceptors',
  'chat-send-turn',
  'chat-tool-round',
  'chat-post-turn-resolution',
  'chat-handoff-transition',
  'chat-turn-failure',
]);

export type ChatWorkflowId = z.infer<typeof chatWorkflowIdSchema>;

/**
 * Tool policy layer used by workflow and step-level policy overlays.
 */
export const workflowToolPolicySchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
});

export type WorkflowToolPolicy = z.infer<typeof workflowToolPolicySchema>;

/**
 * Session policy for workflow/sub-workflow execution.
 * This remains explicit to avoid implicit inheritance surprises.
 */
export const workflowSessionPolicySchema = z.object({
  mode: z.enum([
    'current',
    'handoff_thread',
    'new_thread_session',
    'explicit_session',
    'ephemeral_subagent',
  ]),
  targetSessionId: z.string().optional(),
  threadBehavior: z.enum(['one_session_per_agent', 'allow_multiple_per_agent']).optional(),
  inheritContext: z.enum(['handoff_only', 'summary', 'full_snapshot', 'explicit']).optional(),
  returnMode: z.enum(['none', 'summary_to_parent', 'structured_result']).optional(),
});

export type WorkflowSessionPolicy = z.infer<typeof workflowSessionPolicySchema>;

/**
 * Chat post-turn outcomes intentionally exclude any hire path.
 * Hiring is expected to run in a separate dedicated workflow.
 */
export const chatPostTurnOutcomeSchema = z.enum(['normal_complete', 'handoff_required']);

export type ChatPostTurnOutcome = z.infer<typeof chatPostTurnOutcomeSchema>;

export const chatPostTurnResolutionResultSchema = z.object({
  outcome: chatPostTurnOutcomeSchema,
  handoffTargetId: z.string().optional(),
  handoffTargetSessionId: z.string().optional(),
  handoffNote: z.string().optional(),
});

export type ChatPostTurnResolutionResult = z.infer<typeof chatPostTurnResolutionResultSchema>;

export function parseChatPostTurnResolutionResult(value: unknown): ChatPostTurnResolutionResult {
  return chatPostTurnResolutionResultSchema.parse(value);
}

/**
 * Pre-turn interceptor result contract.
 */
export const chatPreturnOutcomeSchema = z.enum(['consumed', 'forwarded', 'continue']);

export type ChatPreturnOutcome = z.infer<typeof chatPreturnOutcomeSchema>;

export const chatPreturnResultSchema = z.object({
  outcome: chatPreturnOutcomeSchema,
  text: z.string().optional(),
  autoMessage: z.string().optional(),
});

export type ChatPreturnResult = z.infer<typeof chatPreturnResultSchema>;

export function parseChatPreturnResult(value: unknown): ChatPreturnResult {
  return chatPreturnResultSchema.parse(value);
}

/**
 * Tool call payload flowing from send-turn into tool-round handling.
 */
export const chatToolCallSchema = z.object({
  toolName: z.string(),
  args: z.unknown().optional(),
});

export type ChatToolCall = z.infer<typeof chatToolCallSchema>;

/**
 * Single send-turn result contract used by the chat loop machine.
 */
export const chatSendTurnResultSchema = z.object({
  text: z.string(),
  toolRoundNeeded: z.boolean().default(false),
  pendingToolCall: chatToolCallSchema.optional(),
});

export type ChatSendTurnResult = z.infer<typeof chatSendTurnResultSchema>;

export function parseChatSendTurnResult(value: unknown): ChatSendTurnResult {
  return chatSendTurnResultSchema.parse(value);
}

/**
 * Tool round contract for tool dispatch continuation.
 */
export const chatToolRoundOutcomeSchema = z.enum(['resume_llm', 'tool_complete', 'tool_failed']);

export type ChatToolRoundOutcome = z.infer<typeof chatToolRoundOutcomeSchema>;

export const chatToolRoundResultSchema = z.object({
  outcome: chatToolRoundOutcomeSchema,
  error: z.string().optional(),
});

export type ChatToolRoundResult = z.infer<typeof chatToolRoundResultSchema>;

export function parseChatToolRoundResult(value: unknown): ChatToolRoundResult {
  return chatToolRoundResultSchema.parse(value);
}

/**
 * Handoff transition step output.
 */
export const chatHandoffTransitionResultSchema = z.object({
  autoMessage: z.string().optional(),
});

export type ChatHandoffTransitionResult = z.infer<typeof chatHandoffTransitionResultSchema>;

export function parseChatHandoffTransitionResult(value: unknown): ChatHandoffTransitionResult {
  return chatHandoffTransitionResultSchema.parse(value);
}

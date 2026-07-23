export interface ChatInvocationTarget {
  agentId?: string;
  sessionId?: string;
  createNewSession: boolean;
}

/**
 * Resolve the CLI's positional chat target without consulting runtime state.
 *
 * An agent-only invocation starts a new root conversation. Session-based and
 * target-less invocations are resume operations resolved by the thread service.
 */
export function resolveChatInvocationTarget(
  positionals: string[],
  explicitSessionId: string | undefined,
  newSessionRequested: boolean
): ChatInvocationTarget {
  const firstPositional = positionals[0];
  const positionalSessionId = positionals[1];
  const singlePositionalSession =
    !explicitSessionId
    && !positionalSessionId
    && firstPositional?.startsWith('session-');
  const agentId = singlePositionalSession ? undefined : firstPositional;
  const sessionId =
    explicitSessionId
    ?? positionalSessionId
    ?? (singlePositionalSession ? firstPositional : undefined);

  return {
    agentId,
    sessionId,
    createNewSession:
      newSessionRequested
      || Boolean(agentId && !sessionId),
  };
}

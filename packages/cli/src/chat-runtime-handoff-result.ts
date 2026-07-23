interface HandoffTransitionResponse {
  status: string;
  message?: string;
  data?: unknown;
}

export interface SuccessfulHandoffTransition {
  targetAgentId?: string;
  targetSessionId?: string;
}

/**
 * A cancelled or denied handoff is not a transition. Keeping this check at the
 * CLI runtime bridge prevents it from scheduling an acknowledgement against
 * the source session.
 */
export function requireSuccessfulHandoffTransition(
  response: HandoffTransitionResponse
): SuccessfulHandoffTransition {
  if (response.status !== 'ok') {
    throw new Error(response.message || 'handoff transition failed');
  }

  if (!response.data || typeof response.data !== 'object') {
    return {};
  }

  const data = response.data as Record<string, unknown>;
  return {
    ...(typeof data['targetAgentId'] === 'string'
      ? { targetAgentId: data['targetAgentId'] }
      : {}),
    ...(typeof data['targetSessionId'] === 'string'
      ? { targetSessionId: data['targetSessionId'] }
      : {}),
  };
}

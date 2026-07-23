/**
 * Builds the small policy message that accompanies provider-native tool schemas.
 *
 * The names must come from the exact `tools` payload sent to the provider, not
 * command implementation details. `LlmToolDefinition.name` is the canonical,
 * executable identity for this request.
 */
export function buildToolPolicyContent(toolNames: readonly string[]): string {
  const available = new Set(toolNames);
  const hasAskTool = available.has('com_ask');
  const hasHandoffTool = available.has('com_handoff');

  return (
    `Tool-calling is available. The callable tool names for this turn are: ${toolNames.join(', ')}. ` +
    'The provider tool schemas are authoritative; use only these exact names and do not invent tool names or slash commands (for example /agent). ' +
    (hasAskTool
      ? 'If you need clarification or missing input from the developer, call com_ask instead of guessing. '
      : '') +
    (hasHandoffTool
      ? 'com_handoff is available for this turn. If you propose routing, forwarding, transferring, or switching the developer to another agent, you must call com_handoff in this turn. Do not tell the developer to run /agent, chat <agent>, or similar as a substitute for handoff. If the developer explicitly asks to talk, switch, or hand off to a specific agent, call com_handoff directly and do not gate it behind a confirm-style com_ask question. '
      : '') +
    (available.has('tool_list') || available.has('tool_can_i') || available.has('fs_who_can')
      ? 'For questions about available tools, access, or permissions, use an available introspection tool when it can answer accurately. '
      : '') +
    (available.has('fs_tree')
      ? 'For requests to list or show visible/readable files, call fs_tree on path "." (or the requested path) first, then explain the result. '
      : '')
  );
}

export const HANDOFF_AUTO_REACT_MESSAGE =
  '[Handoff received] You have just been handed this conversation. Review the briefing above, acknowledge the context, and ask the developer how they would like to proceed.';

/** Identifies legacy rows created before internal continuations became transient runtime context. */
export function isHandoffAutoReactMessage(content: string): boolean {
  return content.trim() === HANDOFF_AUTO_REACT_MESSAGE;
}

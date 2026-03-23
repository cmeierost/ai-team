import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';

/**
 * A plugin renderer for a specific tool's result.
 *
 * Register via `registerRenderer()` from 'tool-renderers/index'.
 * Third-party integrators can call `registerRenderer()` at startup to add
 * renderers for custom tools.
 */
export interface ToolResultRenderer {
  /** Exact tool name this renderer handles, e.g. 'fs_tree'. */
  toolName: string;

  /**
   * Render the tool result as a React node for display in the overlay.
   *
   * @param result      Raw structured result (toolResult.result) — content
   *                    stored in the database unchanged.
   * @param resultLlm   LLM-formatted representation (toolResult.resultLlm) —
   *                    what was injected into the model's context window.
   *                    Undefined when no `formatForLlm` exists for the tool.
   * @param event       Full tool event for additional context.
   */
  render(result: unknown, resultLlm: unknown, event: SessionActivatedTool): ReactNode;
}

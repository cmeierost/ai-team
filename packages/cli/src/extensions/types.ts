/**
 * Extension registry types.
 */

import type { Component } from '@ai-team/tui';
import type { StreamEvent } from '@ai-team/api-contracts';

/**
 * Custom view provider — renders a named view region.
 */
export interface CustomViewProvider {
  /** View identifier (e.g., 'files', 'problems', 'output') */
  name: string;
  /** View title for the header */
  title: string;
  /** Render the view content */
  render(width: number): Component;
}

/**
 * Custom handler for a specific StreamEvent kind.
 */
export interface StreamEventHandler {
  /** Event kind this handler processes (e.g., 'tool', 'code_edit_proposal') */
  kind: string;
  /**
   * Handle the event. Return a component to display, or null to use default.
   */
  handle(event: StreamEvent<'chat'>): Component | null;
}

/**
 * Custom tool renderer.
 */
export type ToolRenderTarget = 'transcript' | 'composer';

export interface ToolRenderPlacement {
  target: ToolRenderTarget;
  component: Component;
}

export interface NormalizedToolEvent {
  toolName: string;
  phase: 'request' | 'start' | 'result' | 'error' | 'denied';
  callId?: string;
  /** Command descriptor identity used for renderer fallback on slash calls. */
  commandGroup?: string;
  commandKey?: string;
  request?: unknown;
  output?: unknown;
  /** Raw command response data (structured object) — preferred by rich renderers. */
  commandResponseData?: unknown;
  /** Full file contents for user-facing diffs; never forwarded to the LLM. */
  fileChanges?: Array<{ filePath: string; oldContent: string; newContent: string }>;
  error?: unknown;
  denial?: unknown;
  historical: boolean;
}

export interface ToolRenderDecision {
  handled: boolean;
  placements: ToolRenderPlacement[];
}

export interface ToolRenderer {
  /** Tool name pattern to match (supports * wildcard) */
  toolName: string;
  /** Render a normalized lifecycle event into explicit layout targets. */
  render(event: NormalizedToolEvent): ToolRenderDecision;
}

/**
 * Custom question responder.
 */
export interface QuestionResponder {
  /** Question type to handle (e.g., 'select', 'confirm', 'input') */
  type: string;
  /**
   * Handle a question. Return the answer, or null to use default.
   */
  respond(question: unknown): Promise<unknown> | null;
}

/**
 * Slash command handler.
 */
export interface SlashCommandHandler {
  /** Command name without leading / (e.g., 'clear', 'help') */
  name: string;
  /** Command description for help */
  description?: string;
  /** Execute the command */
  execute(args: string): void;
}

/**
 * Extension manifest.
 */
export interface ExtensionManifest {
  /** Extension name */
  name: string;
  /** Extension version */
  version?: string;
  /** Custom views provided by this extension */
  views?: CustomViewProvider[];
  /** Stream event handlers */
  handlers?: StreamEventHandler[];
  /** Tool renderers */
  toolRenderers?: ToolRenderer[];
  /** Question responders */
  questionResponders?: QuestionResponder[];
  /** Slash commands */
  slashCommands?: SlashCommandHandler[];
}

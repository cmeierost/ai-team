/**
 * Extension registry types.
 */

import { Component } from '@ai-team/tui';
import { StreamEvent } from '@ai-team/api-contracts';

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
export interface ToolRenderer {
  /** Tool name pattern to match (supports * wildcard) */
  toolName: string;
  /** Render a tool event as a component */
  render(toolName: string, input: unknown, output?: unknown): Component;
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

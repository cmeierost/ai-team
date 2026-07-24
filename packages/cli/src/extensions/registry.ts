/**
 * Extension registry — manages installed extensions and their providers.
 */

import {
  type CustomViewProvider,
  type StreamEventHandler,
  type ToolRenderer,
  type QuestionResponder,
  type SlashCommandHandler,
  type ExtensionManifest,
  type NormalizedToolEvent,
  type ToolRenderDecision,
} from './types.js';
import { createDefaultToolRendererManifest } from './default-tool-renderers.js';

/**
 * Extension registry — discovers and manages extensions.
 */
export class ExtensionRegistry {
  private readonly views: Map<string, CustomViewProvider> = new Map();
  private readonly handlers: Map<string, StreamEventHandler[]> = new Map();
  private readonly toolRenderers: ToolRenderer[] = [];
  private readonly questionResponders: Map<string, QuestionResponder[]> = new Map();
  private readonly slashCommands: Map<string, SlashCommandHandler> = new Map();

  constructor() {
    this.register(createDefaultToolRendererManifest());
  }

  /**
   * Register an extension from its manifest.
   */
  register(manifest: ExtensionManifest): void {
    for (const view of manifest.views ?? []) {
      this.views.set(view.name, view);
    }

    for (const handler of manifest.handlers ?? []) {
      const existing = this.handlers.get(handler.kind) ?? [];
      existing.push(handler);
      this.handlers.set(handler.kind, existing);
    }

    for (const renderer of manifest.toolRenderers ?? []) {
      this.toolRenderers.push(renderer);
    }

    for (const responder of manifest.questionResponders ?? []) {
      const existing = this.questionResponders.get(responder.type) ?? [];
      existing.push(responder);
      this.questionResponders.set(responder.type, existing);
    }

    for (const cmd of manifest.slashCommands ?? []) {
      this.slashCommands.set(cmd.name, cmd);
    }
  }

  /**
   * Get a custom view by name.
   */
  getView(name: string): CustomViewProvider | undefined {
    return this.views.get(name);
  }

  /**
   * Get all custom views.
   */
  getViews(): CustomViewProvider[] {
    return Array.from(this.views.values());
  }

  /**
   * Get handlers for a specific event kind.
   */
  getHandlers(kind: string): StreamEventHandler[] {
    return this.handlers.get(kind) ?? [];
  }

  /**
   * Try to render a tool event with a custom renderer.
   *
   * Slash commands carry their command descriptor identity. The group/key
   * pair defines the renderer key using the same `group_key` convention as
   * ordinary tool calls.
   *
   * Exact matches are always preferred over wildcard matches so that a
   * specific renderer (e.g. `fs_tree`) wins over a broad catch-all
   * (e.g. `slash:*`).
   */
  renderTool(event: NormalizedToolEvent): ToolRenderDecision {
    const toolNamesToTry = [event.toolName];
    if (event.commandGroup && event.commandKey) {
      const commandRendererKey = `${event.commandGroup}_${event.commandKey}`;
      if (commandRendererKey !== event.toolName) {
        toolNamesToTry.push(commandRendererKey);
      }
    }

    // 1. Exact match pass — any renderer whose toolName exactly matches
    //    one of our candidate names wins immediately.
    const exact = this.findExactMatch(toolNamesToTry);
    if (exact) return exact.render(event);

    // 2. Wildcard match pass — fall back to pattern matching.
    const wildcard = this.findWildcardMatch(toolNamesToTry);
    if (wildcard) return wildcard.render(event);

    return { handled: false, placements: [] };
  }

  private findExactMatch(toolNames: string[]): ToolRenderer | undefined {
    for (let index = this.toolRenderers.length - 1; index >= 0; index -= 1) {
      const renderer = this.toolRenderers[index];
      if (!renderer) continue;
      for (const name of toolNames) {
        if (renderer.toolName === name) return renderer;
      }
    }
    return undefined;
  }

  private findWildcardMatch(toolNames: string[]): ToolRenderer | undefined {
    for (let index = this.toolRenderers.length - 1; index >= 0; index -= 1) {
      const renderer = this.toolRenderers[index];
      if (!renderer) continue;
      for (const name of toolNames) {
        if (this.matchesToolPattern(renderer.toolName, name)) return renderer;
      }
    }
    return undefined;
  }

  /**
   * Try to respond to a question with a custom responder.
   */
  async respondToQuestion(type: string, question: unknown): Promise<unknown | null> {
    const responders = this.questionResponders.get(type) ?? [];
    for (const responder of responders) {
      const answer = await responder.respond(question);
      if (answer !== null) return answer;
    }
    return null;
  }

  /**
   * Get a slash command by name.
   */
  getSlashCommand(name: string): SlashCommandHandler | undefined {
    return this.slashCommands.get(name);
  }

  /**
   * Get all slash commands.
   */
  getSlashCommands(): SlashCommandHandler[] {
    return Array.from(this.slashCommands.values());
  }

  /**
   * Get available slash commands for autocomplete.
   */
  getSlashCommandNames(): string[] {
    return Array.from(this.slashCommands.keys());
  }

  private matchesToolPattern(pattern: string, toolName: string): boolean {
    if (pattern === toolName) return true;
    if (pattern === '*') return true;

    // Simple wildcard matching
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(toolName);
    }

    return false;
  }
}

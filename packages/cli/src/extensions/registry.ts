/**
 * Extension registry — manages installed extensions and their providers.
 */

import type { Component } from '@ai-team/tui';
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

/**
 * Extension registry — discovers and manages extensions.
 */
export class ExtensionRegistry {
  private readonly views: Map<string, CustomViewProvider> = new Map();
  private readonly handlers: Map<string, StreamEventHandler[]> = new Map();
  private readonly toolRenderers: ToolRenderer[] = [];
  private readonly questionResponders: Map<string, QuestionResponder[]> = new Map();
  private readonly slashCommands: Map<string, SlashCommandHandler> = new Map();

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
   */
  renderTool(event: NormalizedToolEvent): ToolRenderDecision {
    const exact = this.toolRenderers.find((renderer) => renderer.toolName === event.toolName);
    if (exact) return exact.render(event);

    for (const renderer of this.toolRenderers) {
      if (
        renderer.toolName !== event.toolName
        && this.matchesToolPattern(renderer.toolName, event.toolName)
      ) {
        return renderer.render(event);
      }
    }
    return { handled: false, placements: [] };
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

import type { ToolResultRenderer } from './types';

const renderers = new Map<string, ToolResultRenderer>();

/**
 * Register a tool result renderer. Replaces any existing renderer for the
 * same toolName. Safe to call from module-level side-effect imports.
 */
export function registerRenderer(renderer: ToolResultRenderer): void {
  renderers.set(renderer.toolName, renderer);
}

/** Returns the registered renderer for a tool, or undefined if none. */
export function getRenderer(toolName: string): ToolResultRenderer | undefined {
  return renderers.get(toolName);
}

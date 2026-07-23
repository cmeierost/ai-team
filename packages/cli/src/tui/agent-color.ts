/**
 * Agent color utilities for TUI rendering.
 *
 * Converts HSL (from Agent.avatar.color) to RGB for terminal escape sequences.
 * AgentDisplayInfo is a TUI display type — not a domain entity.
 */

import { TextOptions } from '@ai-team/tui';

/**
 * Agent display info for TUI rendering (name + RGB color + optional model).
 */
export interface AgentDisplayInfo {
  name: string;
  color: { r: number; g: number; b: number };
  model?: string;
}

/**
 * Resolve a readable fallback without inventing domain state. The service can
 * replace it with authoritative agent_info data as soon as that event arrives.
 */
export function normalizeAgentDisplayName(agentName?: string, agentId?: string): string {
  const explicit = agentName?.trim();
  if (explicit) return explicit;

  const fallback = agentId?.trim();
  if (!fallback) return 'Agent';

  return fallback
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Parse an HSL color string to RGB.
 */
function hslToRgb(hsl: string): { r: number; g: number; b: number } | null {
  const re = /^hsl\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)$/i;
  const parts = re.exec(hsl);
  if (!parts) return null;
  const hue = Number(parts[1]);
  const sat = Number(parts[2]) / 100;
  const lit = Number(parts[3]) / 100;
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const mOff = lit - c / 2;
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (hue < 60) {
    r1 = c;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
  } else if (hue < 180) {
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return {
    r: Math.round((r1 + mOff) * 255),
    g: Math.round((g1 + mOff) * 255),
    b: Math.round((b1 + mOff) * 255),
  };
}

/**
 * Generate a consistent color from an agent name (fallback when no avatar color).
 */
function agentColorFromName(name: string): { r: number; g: number; b: number } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  }
  return {
    r: ((hash & 0xff) % 200) + 30,
    g: (((hash >> 8) & 0xff) % 200) + 30,
    b: (((hash >> 16) & 0xff) % 200) + 30,
  };
}

/**
 * Resolve agent display info from runtime event payload data.
 */
export function resolveAgentDisplay(opts: {
  name: string;
  avatarColor?: string;
  model?: string;
}): AgentDisplayInfo {
  const { name, avatarColor, model } = opts;
  const color = avatarColor
    ? (hslToRgb(avatarColor) ?? agentColorFromName(name))
    : agentColorFromName(name);
  return { name, color, model };
}

/**
 * Create an ANSI escape color function for an agent.
 */
export function agentChalk(agent: AgentDisplayInfo | null): (text: string) => string {
  if (!agent) return (text: string) => text;
  const { r, g, b } = agent.color;
  return (text: string) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

/**
 * Create TextOptions for an agent's color.
 */
export function agentTextOptions(agent: AgentDisplayInfo | null): TextOptions | undefined {
  if (!agent) return undefined;
  return { fg: agent.color };
}

/**
 * Pick a subtle tinted surface with strong contrast against the agent's main
 * color. This works on both dark and light terminal themes without assuming
 * the terminal's configured background.
 */
export function agentMessageBackground(
  agent: AgentDisplayInfo
): { r: number; g: number; b: number } {
  const foreground = agent.color;
  const dark = {
    r: Math.round(foreground.r * 0.12),
    g: Math.round(foreground.g * 0.12),
    b: Math.round(foreground.b * 0.12),
  };
  const light = {
    r: Math.min(255, Math.round(242 + foreground.r * 0.05)),
    g: Math.min(255, Math.round(242 + foreground.g * 0.05)),
    b: Math.min(255, Math.round(242 + foreground.b * 0.05)),
  };

  return contrastRatio(foreground, dark) >= contrastRatio(foreground, light)
    ? dark
    : light;
}

function contrastRatio(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number }
): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r)
    + 0.7152 * channel(color.g)
    + 0.0722 * channel(color.b)
  );
}

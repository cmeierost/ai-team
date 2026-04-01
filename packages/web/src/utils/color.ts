import type { Agent } from '../types';

/**
 * Generate a deterministic color from agent name using HSL
 */
function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 360);
}

/** Extract hue (0–359) from a hex (#rrggbb) or hsl(...) color string. */
function hueFromColor(color: string): number | null {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h = 0;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return Math.round(h * 60);
  }
  const m = color.match(/hsl\(\s*(\d+)/);
  if (m) return parseInt(m[1]);
  return null;
}

/** Convert hsl(h, s%, l%) to #rrggbb for use in <input type="color">. */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Get agent color - reads avatar.color if set, otherwise derives from seed/name.
 */
export function getAgentColor(agent: Agent): string {
  if (agent.avatar?.color) return agent.avatar.color;
  const colorSeed = agent.avatar?.seed || agent.name;
  const hue = hashStringToHue(colorSeed);
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Get just the hue number for an agent (0–359).
 * Reads avatar.color if set, otherwise derives from seed/name.
 */
export function getAgentHue(agent: Agent): number {
  if (agent.avatar?.color) {
    const hue = hueFromColor(agent.avatar.color);
    if (hue !== null) return hue;
  }
  const colorSeed = agent.avatar?.seed || agent.name;
  return hashStringToHue(colorSeed);
}

/**
 * Get agent color as a hex string suitable for <input type="color">.
 */
export function getAgentColorHex(agent: Agent): string {
  if (agent.avatar?.color?.startsWith('#')) return agent.avatar.color;
  const hue = getAgentHue(agent);
  return hslToHex(hue, 70, 60);
}

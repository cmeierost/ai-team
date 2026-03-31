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

/**
 * Get agent color - deterministically derived from avatar seed or name
 */
export function getAgentColor(agent: Agent): string {
  const colorSeed = agent.avatar?.seed || agent.name;
  const hue = hashStringToHue(colorSeed);
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Get just the hue number for an agent (0–359).
 * Useful for building CSS hsl() values without color-mix().
 */
export function getAgentHue(agent: Agent): number {
  const colorSeed = agent.avatar?.seed || agent.name;
  return hashStringToHue(colorSeed);
}

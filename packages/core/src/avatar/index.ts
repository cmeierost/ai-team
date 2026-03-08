/**
 * Avatar management module
 * Handles downloading random avatars and generating AI avatars for agents
 */

import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import OpenAI from 'openai';
import type { Agent, LlmProviderConfig } from '../types/index.js';
import { saveAgent } from '../storage/index.js';

// ── Deterministic agent color ─────────────────────────────────────────────────

/**
 * Generate a deterministic hue (0-359) from a string using a simple hash.
 * Matches the algorithm used by the web UI so colours are consistent.
 */
function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 360);
}

/**
 * Return a deterministic HSL color string for an agent.
 *
 * Priority:
 *   1. `agent.avatar.color` (explicit setting in agent file)
 *   2. Hash of `agent.avatar.seed` or `agent.name`
 */
export function generateAgentColor(agent: Pick<Agent, 'name' | 'avatar'>): string {
  if (agent.avatar?.color) return agent.avatar.color;
  const seed = agent.avatar?.seed || agent.name;
  const hue = hashStringToHue(seed);
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Parse an HSL color string into its hue component (0-359).
 * Returns undefined for non-HSL strings.
 */
export function parseHslHue(hsl: string): number | undefined {
  const m = hsl.match(/^hsl\((\d+)/i);
  return m ? Number(m[1]) : undefined;
}

/**
 * Resizes an image to 150px height while maintaining aspect ratio
 * @param imageBuffer - Original image buffer
 * @returns Resized image buffer as JPEG
 */
async function resizeImage(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize({ height: 150, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * Substitutes placeholders in URL templates with agent data
 * Supported placeholders: {name}, {id}, {seed}
 */
export function substituteUrlPlaceholders(urlTemplate: string, agent: Agent): string {
  return urlTemplate
    .replace(/\{name\}/g, encodeURIComponent(agent.name))
    .replace(/\{id\}/g, encodeURIComponent(agent.id))
    .replace(/\{seed\}/g, encodeURIComponent(agent.id));
}

/**
 * Downloads a random avatar from a URL
 * @param urlTemplate - URL with optional placeholders {name}, {id}, {seed}
 * @param agent - Agent to download avatar for
 * @returns Image data as Buffer (resized to 150px height)
 */
export async function downloadRandomAvatar(
  urlTemplate: string,
  agent: Agent
): Promise<Buffer> {
  const url = substituteUrlPlaceholders(urlTemplate, agent);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download avatar from ${url}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const originalBuffer = Buffer.from(arrayBuffer);
  
  // Resize to 150px height
  return resizeImage(originalBuffer);
}

/**
 * Generates an avatar using an AI image generation model
 * @param prompt - Text prompt describing the avatar
 * @param provider - LLM provider configuration
 * @param modelName - Name of the image generation model
 * @param apiKey - API key for the provider
 * @returns Image data as Buffer (resized to 150px height)
 */
export async function generateAvatarWithAI(
  prompt: string,
  provider: LlmProviderConfig,
  modelName: string,
  apiKey: string
): Promise<Buffer> {
  // Create OpenAI client with provider's baseUrl
  const openai = new OpenAI({
    apiKey,
    baseURL: provider.baseUrl,
  });

  // Generate image using OpenAI-compatible API
  const response = await openai.images.generate({
    model: modelName,
    prompt,
    n: 1,
    size: '1024x1024',
    response_format: 'url',
  });

  const imageUrl = response.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error('No image URL returned from generation API');
  }

  // Download the generated image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
  }

  const arrayBuffer = await imageResponse.arrayBuffer();
  const originalBuffer = Buffer.from(arrayBuffer);
  
  // Resize to 150px height
  return resizeImage(originalBuffer);
}

/**
 * Builds a default avatar prompt from agent profile
 * @param agent - Agent to build prompt for
 * @returns Generated prompt string
 */
export function buildAvatarPrompt(agent: Agent): string {
  const parts: string[] = ['Professional headshot portrait of'];
  
  // Add name
  parts.push(agent.name);
  
  // Add role
  if (agent.role) {
    parts.push(`a ${agent.role}`);
  }
  
  // Add personality traits
  if (agent.personality) {
    const traits: string[] = [];
    if (agent.personality.communication_style) {
      traits.push(agent.personality.communication_style);
    }
    if (agent.personality.expertise_level) {
      traits.push(agent.personality.expertise_level);
    }
    if (traits.length > 0) {
      parts.push(traits.join(' and '));
    }
  }
  
  // Add style guidance
  parts.push('in a professional setting, photorealistic, high quality');
  
  return parts.join(', ');
}

/**
 * Saves avatar image data to a preview file
 * @param agentName - Name of the agent (used for filename)
 * @param imageData - Image data as Buffer
 * @param workspaceRoot - Workspace root directory
 * @returns Absolute path to the saved preview file
 */
export async function saveAvatarPreview(
  agentName: string,
  imageData: Buffer,
  workspaceRoot: string
): Promise<string> {
  const avatarsDir = path.join(workspaceRoot, '.ai-team', 'avatars');
  await fs.mkdir(avatarsDir, { recursive: true });
  
  const fileName = `${agentName}-preview.jpg`;
  const filePath = path.join(avatarsDir, fileName);
  
  await fs.writeFile(filePath, imageData);
  return filePath;
}

/**
 * Finalizes an avatar by renaming preview to permanent file
 * @param agentName - Name of the agent
 * @param workspaceRoot - Workspace root directory
 * @returns Relative path to the finalized avatar (from workspace root)
 */
export async function finalizeAvatar(
  agentName: string,
  workspaceRoot: string
): Promise<string> {
  const avatarsDir = path.join(workspaceRoot, '.ai-team', 'avatars');
  const previewPath = path.join(avatarsDir, `${agentName}-preview.jpg`);
  const finalPath = path.join(avatarsDir, `${agentName}.jpg`);
  
  // Remove existing avatar if it exists
  try {
    await fs.unlink(finalPath);
  } catch (err) {
    // Ignore if file doesn't exist
  }
  
  // Rename preview to final
  await fs.rename(previewPath, finalPath);
  
  // Return relative path from workspace root
  return `.ai-team/avatars/${agentName}.jpg`;
}

/**
 * Cleans up avatar preview file
 * @param agentName - Name of the agent
 * @param workspaceRoot - Workspace root directory
 */
export async function cleanupPreview(
  agentName: string,
  workspaceRoot: string
): Promise<void> {
  const avatarsDir = path.join(workspaceRoot, '.ai-team', 'avatars');
  const previewPath = path.join(avatarsDir, `${agentName}-preview.jpg`);
  
  try {
    await fs.unlink(previewPath);
  } catch (err) {
    // Ignore if file doesn't exist
  }
}

/**
 * Updates agent's avatar configuration and adds image link to markdown
 * @param agent - Agent to update
 * @param avatarRelPath - Relative path to avatar image
 * @param workspaceRoot - Workspace root directory
 */
export async function updateAgentAvatar(
  agent: Agent,
  avatarRelPath: string,
  workspaceRoot: string
): Promise<void> {
  // Update avatar config to use URL type
  agent.avatar = {
    type: 'url',
    url: avatarRelPath,
  };
  
  // Add or update image link in markdown body
  const imageMarkdown = `![avatar](../avatars/${agent.id}.jpg)`;
  
  if (agent.markdown) {
    // Check if there's already an avatar image
    const avatarRegex = /!\[avatar\]\([^)]+\)/;
    if (avatarRegex.test(agent.markdown)) {
      // Replace existing avatar
      agent.markdown = agent.markdown.replace(avatarRegex, imageMarkdown);
    } else {
      // Prepend new avatar
      agent.markdown = `${imageMarkdown}\n\n${agent.markdown}`;
    }
  } else {
    // Create new markdown with avatar
    agent.markdown = imageMarkdown;
  }
  
  // Save updated agent
  await saveAgent(agent);
}

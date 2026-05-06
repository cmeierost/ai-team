/**
 * Avatar management module
 * Handles downloading random avatars and generating AI avatars for agents
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import OpenAI from 'openai';
import type {
  Agent,
  LlmProviderConfig,
  IAgentDocumentStorage,
  IAvatarManager,
} from '@ai-team/core';
import { AgentDocumentStorage } from './agent-document-storage.js';
import { MarkdownSectionService } from './markdown-service.js';
import { WorkspaceDiscoveryStorage } from './workspace-discovery-storage.js';
import { WorkspaceStorage } from './workspace-storage.js';

export class AvatarManager implements IAvatarManager {
  constructor(private readonly agentDocumentStorage: IAgentDocumentStorage) {}

  /**
   * Generate a deterministic hue (0-359) from a string using a simple hash.
   * Matches the algorithm used by the web UI so colours are consistent.
   */
  private hashStringToHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash % 360);
  }

  /**
   * Resizes an image to 150px height while maintaining aspect ratio.
   */
  private async resizeImage(imageBuffer: Buffer): Promise<Buffer> {
    return sharp(imageBuffer)
      .resize({ height: 150, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  generateAgentColor(agent: Pick<Agent, 'name' | 'avatar'>): string {
    if (agent.avatar?.color) return agent.avatar.color;
    const seed = agent.avatar?.seed || agent.name;
    const hue = this.hashStringToHue(seed);
    return `hsl(${hue}, 70%, 60%)`;
  }

  parseHslHue(hsl: string): number | undefined {
    const m = hsl.match(/^hsl\((\d+)/i);
    return m ? Number(m[1]) : undefined;
  }

  substituteUrlPlaceholders(urlTemplate: string, agent: Agent): string {
    return urlTemplate
      .replace(/\{name\}/g, encodeURIComponent(agent.name))
      .replace(/\{id\}/g, encodeURIComponent(agent.id))
      .replace(/\{seed\}/g, encodeURIComponent(agent.id));
  }

  async downloadRandomAvatar(urlTemplate: string, agent: Agent): Promise<Buffer> {
    const url = this.substituteUrlPlaceholders(urlTemplate, agent);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download avatar from ${url}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);
    return this.resizeImage(originalBuffer);
  }

  async generateAvatarWithAI(
    prompt: string,
    provider: LlmProviderConfig,
    modelName: string,
    apiKey: string
  ): Promise<Buffer> {
    const openai = new OpenAI({
      apiKey,
      baseURL: provider.baseUrl,
    });

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

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);
    return this.resizeImage(originalBuffer);
  }

  buildAvatarPrompt(agent: Agent): string {
    const parts: string[] = ['Professional headshot portrait of'];
    parts.push(agent.name);

    if (agent.role) {
      parts.push(`a ${agent.role}`);
    }

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

    parts.push('in a professional setting, photorealistic, high quality');
    return parts.join(', ');
  }

  async saveAvatarPreview(
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

  async finalizeAvatar(agentName: string, workspaceRoot: string): Promise<string> {
    const avatarsDir = path.join(workspaceRoot, '.ai-team', 'avatars');
    const previewPath = path.join(avatarsDir, `${agentName}-preview.jpg`);
    const finalPath = path.join(avatarsDir, `${agentName}.jpg`);

    try {
      await fs.unlink(finalPath);
    } catch {
      // Ignore if file doesn't exist
    }

    await fs.rename(previewPath, finalPath);
    return `.ai-team/avatars/${agentName}.jpg`;
  }

  async cleanupPreview(agentName: string, workspaceRoot: string): Promise<void> {
    const avatarsDir = path.join(workspaceRoot, '.ai-team', 'avatars');
    const previewPath = path.join(avatarsDir, `${agentName}-preview.jpg`);

    try {
      await fs.unlink(previewPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async updateAgentAvatar(
    agent: Agent,
    avatarRelPath: string,
    workspaceRoot: string
  ): Promise<void> {
    agent.avatar = {
      type: 'url',
      url: avatarRelPath,
    };

    const imageMarkdown = `![avatar](../avatars/${agent.id}.jpg)`;

    if (agent.markdown) {
      const avatarRegex = /!\[avatar\]\([^)]+\)/;
      if (avatarRegex.test(agent.markdown)) {
        agent.markdown = agent.markdown.replace(avatarRegex, imageMarkdown);
      } else {
        agent.markdown = `${imageMarkdown}\n\n${agent.markdown}`;
      }
    } else {
      agent.markdown = imageMarkdown;
    }

    await this.agentDocumentStorage.saveAgentAsync(agent);
  }
}

export function createAvatarManager(): AvatarManager {
  const markdownSectionService = new MarkdownSectionService();
  const workspaceStorage = new WorkspaceStorage();
  const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();
  const agentDocumentStorage = new AgentDocumentStorage(
    markdownSectionService,
    workspaceStorage,
    workspaceDiscoveryStorage
  );

  return new AvatarManager(agentDocumentStorage);
}

export const avatarManager = createAvatarManager();
export const generateAgentColor = avatarManager.generateAgentColor.bind(avatarManager);
export const parseHslHue = avatarManager.parseHslHue.bind(avatarManager);
export const substituteUrlPlaceholders =
  avatarManager.substituteUrlPlaceholders.bind(avatarManager);
export const downloadRandomAvatar = avatarManager.downloadRandomAvatar.bind(avatarManager);
export const generateAvatarWithAI = avatarManager.generateAvatarWithAI.bind(avatarManager);
export const buildAvatarPrompt = avatarManager.buildAvatarPrompt.bind(avatarManager);
export const saveAvatarPreview = avatarManager.saveAvatarPreview.bind(avatarManager);
export const finalizeAvatar = avatarManager.finalizeAvatar.bind(avatarManager);
export const cleanupPreview = avatarManager.cleanupPreview.bind(avatarManager);
export const updateAgentAvatar = avatarManager.updateAgentAvatar.bind(avatarManager);

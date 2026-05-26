import type { Agent, LlmProviderConfig } from '../types/index.js';

export interface IAvatarManager {
  generateAgentColor(agent: Pick<Agent, 'name' | 'avatar'>): string;
  parseHslHue(hsl: string): number | undefined;
  substituteUrlPlaceholders(urlTemplate: string, agent: Agent): string;
  downloadRandomAvatar(urlTemplate: string, agent: Agent): Promise<Buffer>;
  generateAvatarWithAI(
    prompt: string,
    provider: LlmProviderConfig,
    modelName: string,
    apiKey: string
  ): Promise<Buffer>;
  buildAvatarPrompt(agent: Agent): string;
  saveAvatarPreview(agentName: string, imageData: Buffer, workspaceRoot: string): Promise<string>;
  finalizeAvatar(agentName: string, workspaceRoot: string): Promise<string>;
  cleanupPreview(agentName: string, workspaceRoot: string): Promise<void>;
  updateAgentAvatar(agent: Agent, avatarRelPath: string, workspaceRoot: string): Promise<void>;
}

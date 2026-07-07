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
  saveAvatarPreview(agentName: string, imageData: Buffer): Promise<string>;
  finalizeAvatar(agentName: string): Promise<string>;
  cleanupPreview(agentName: string): Promise<void>;
  updateAgentAvatar(agent: Agent, avatarRelPath: string): Promise<void>;
}

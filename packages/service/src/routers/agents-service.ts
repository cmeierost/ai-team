import type {
  Agent,
  AgentConfig,
  AnnotatedFile,
  ChatCommandRegistryEntry,
  MarkdownSection,
  SearchAgentsResponse,
  IAgentsService,
} from '@ai-team/api-client';
import type { AgentManager } from '@ai-team/infrastructure';
import {
  AgentSchema,
  loadEffectiveConfig,
  resolveEffectiveLlmSettings,
  getAnnotatedFiles,
  parseMarkdownSections,
  replaceOrAppendMarkdownSection,
} from '@ai-team/infrastructure';
import { join } from 'node:path';
import { BadRequestError, NotFoundError } from '../http-errors.js';
import { ToolManager } from '../tools/tool-manager.js';

function parseArrayParam(param: unknown): string[] | undefined {
  if (!param) return undefined;
  return Array.isArray(param) ? (param as string[]) : [param as string];
}

export class AgentsService implements IAgentsService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: AgentManager,
    private readonly toolManager: ToolManager
  ) {}

  async list(): Promise<Agent[]> {
    const agents = await this.agentManager.getAllAgentsAsync();
    const effectiveConfig = await loadEffectiveConfig(this.agentManager.workspaceRoot);
    return agents.map((agent) => {
      if (!effectiveConfig) return agent as Agent;
      try {
        const resolved = resolveEffectiveLlmSettings(effectiveConfig, agent as any);
        const hasExplicit = Boolean((agent as any).llm?.provider || (agent as any).llm?.model);
        return {
          ...agent,
          resolvedLlm: {
            providerRef: resolved.providerRef,
            model: resolved.config.model,
            contextWindow: resolved.contextWindow,
            isDefault: !hasExplicit,
          },
        };
      } catch {
        return agent;
      }
    });
  }

  async search(query?: Record<string, unknown>): Promise<SearchAgentsResponse> {
    const searchRequest = {
      query: query?.q as string,
      role: parseArrayParam(query?.role),
      type: parseArrayParam(query?.type),
      status: parseArrayParam(query?.status),
      feature: parseArrayParam(query?.feature),
      specialization: parseArrayParam(query?.specialization),
      tool: parseArrayParam(query?.tool),
      reportsTo: query?.reportsTo as string,
      contextLevel: parseArrayParam(query?.contextLevel),
    };
    const clean = Object.fromEntries(
      Object.entries(searchRequest).filter(([, v]) => v !== undefined)
    );
    const results = await this.agentManager.searchAgentsAsync(clean as any);
    return { results, totalCount: results.length };
  }

  async resolve(id: string): Promise<Agent> {
    const agents = await this.agentManager.resolveAgentAsync(id);
    if (agents.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return agents[0] as Agent;
  }

  async getFrontmatter(id: string): Promise<AgentConfig> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return matches[0] as unknown as AgentConfig;
  }

  async updateFrontmatter(id: string, body: Record<string, unknown>): Promise<Agent> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    const parsed = AgentSchema.partial().safeParse(body);
    if (!parsed.success)
      throw new BadRequestError(`Invalid frontmatter: ${JSON.stringify(parsed.error.issues)}`);
    return this.agentManager.updateAgentAsync(matches[0].id, parsed.data);
  }

  async uploadAvatar(id: string, body: { data: string; ext: string }): Promise<Agent> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    if (!body.data || !body.ext) throw new BadRequestError('data and ext are required');
    if (!/^[a-z0-9]+$/i.test(body.ext)) throw new BadRequestError('invalid ext');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const avatarsDir = join(this.agentManager.workspaceRoot, '.ai-team', 'avatars');
    mkdirSync(avatarsDir, { recursive: true });
    const filename = `${matches[0].id}.${body.ext}`;
    writeFileSync(join(avatarsDir, filename), Buffer.from(body.data, 'base64'));
    const agent = matches[0] as any;
    return this.agentManager.updateAgentAsync(matches[0].id, {
      avatar: { ...agent.avatar, type: 'url', url: `.ai-team/avatars/${filename}` },
    });
  }

  async getSections(id: string): Promise<MarkdownSection[]> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return parseMarkdownSections((matches[0] as any).markdown || '');
  }

  async updateSection(id: string, heading: string, body: { content: string }): Promise<Agent> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    if (typeof body.content !== 'string') throw new BadRequestError('content is required');
    const existing = matches[0] as any;
    const updated = replaceOrAppendMarkdownSection(existing.markdown || '', heading, body.content);
    return this.agentManager.updateAgentAsync(existing.id, { markdown: updated });
  }

  async getMarkdown(id: string): Promise<{ markdown: string }> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return { markdown: (matches[0] as any).markdown || '' };
  }

  async updateMarkdown(id: string, body: { markdown: string }): Promise<Agent> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    if (typeof body.markdown !== 'string') throw new BadRequestError('markdown is required');
    return this.agentManager.updateAgentAsync(matches[0].id, { markdown: body.markdown });
  }

  async getFiles(id: string): Promise<{ files: AnnotatedFile[] }> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    const files = getAnnotatedFiles(this.workspaceRoot, undefined, []);
    return { files: files as AnnotatedFile[] };
  }

  async generateHandoffPrompt(
    id: string,
    body: { targetAgentId: string; context?: string }
  ): Promise<{ prompt: string }> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return { prompt: '' };
  }

  async getSlashCommands(id: string): Promise<ChatCommandRegistryEntry[]> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return [];
  }
}

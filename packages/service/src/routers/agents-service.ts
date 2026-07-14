import type {
  Agent,
  AgentConfig,
  AnnotatedFile,
  ChatCommandRegistryEntry,
  MarkdownSection,
  SearchAgentsResponse,
  IAgentsService,
} from '@ai-team/api-contracts';
import { IntroductionRenderer } from '../commands/chat/introduction.command.js';
import type {
  IAgentManager,
  TeamConfig,
  IFileAnnotationService,
  IMarkdownSectionService,
  IPermissionStorage,
} from '@ai-team/core';
import { listCachedWorkspaceFiles } from 'fs-context';
import { AgentSchema, BadRequestError, NotFoundError } from '@ai-team/core';
import { join } from 'node:path';
import { resolveEffectiveLlmSettings } from '../llm/settings.js';

function parseArrayParam(param: unknown): string[] | undefined {
  if (!param) return undefined;
  return Array.isArray(param) ? (param as string[]) : [param as string];
}

export class AgentsService implements IAgentsService {
  private readonly introductionRenderer: IntroductionRenderer;

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly teamConfig: TeamConfig,
    private readonly permRegistry: IPermissionStorage,
    private readonly markdownSectionService: IMarkdownSectionService,
    private readonly fileAnnotationService: IFileAnnotationService
  ) {
    this.introductionRenderer = new IntroductionRenderer(this.markdownSectionService);
  }

  async list(): Promise<Agent[]> {
    const agents = await this.agentManager.getAllAgentsAsync();
    return agents.map((agent) => {
      if (!this.teamConfig) return agent;
      try {
        const resolved = resolveEffectiveLlmSettings(this.teamConfig, agent as any);
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
    return agents[0];
  }

  async getFrontmatter(id: string): Promise<AgentConfig> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return matches[0];
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
    const avatarsDir = join(this.workspaceRoot, '.ai-team', 'avatars');
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
    return this.markdownSectionService.parseMarkdownSections((matches[0] as any).markdown || '');
  }

  async updateSection(id: string, heading: string, body: { content: string }): Promise<Agent> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    if (typeof body.content !== 'string') throw new BadRequestError('content is required');
    const existing = matches[0] as any;
    const updated = this.markdownSectionService.replaceOrAppendMarkdownSection(
      existing.markdown || '',
      heading,
      body.content
    );
    return this.agentManager.updateAgentAsync(existing.id, { markdown: updated });
  }

  async getBio(id: string): Promise<{ bio: string | null }> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    const sections = this.markdownSectionService.parseMarkdownSections(
      (matches[0] as any).markdown || ''
    );
    const preamble = sections.find((s) => s.heading === '');
    if (!preamble) return { bio: null };
    const bio = preamble.content
      .replace(/^!\[[^\]]*\]\([^)]*\)\n*/m, '') // strip avatar image line
      .replace(/^#+[^\n]*\n*/m, '') // strip h1 heading
      .trimStart();
    return { bio: bio || null };
  }

  async updateBio(id: string, body: { bio: string }): Promise<Agent> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    if (typeof body.bio !== 'string') throw new BadRequestError('bio is required');
    const existing = matches[0] as any;
    const sections = this.markdownSectionService.parseMarkdownSections(existing.markdown || '');
    const preamble = sections.find((s) => s.heading === '');
    // Preserve any existing avatar line and h1 heading from the current preamble
    let prefix = '';
    if (preamble) {
      const avatarMatch = preamble.content.match(/^!\[[^\]]*\]\([^)]*\)\n*/m);
      const h1Match = preamble.content.match(/^#+[^\n]*\n*/m);
      if (avatarMatch) prefix += avatarMatch[0];
      if (h1Match) prefix += h1Match[0];
    }
    if (!prefix) prefix = `# ${(existing as any).name ?? id}\n\n`;
    const newContent = `${prefix}${body.bio.trim()}`;
    const updated = this.markdownSectionService.replaceOrAppendMarkdownSection(
      existing.markdown || '',
      '',
      newContent
    );
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

  async getFiles(id: string): Promise<{
    files: AnnotatedFile[];
    readPatterns: string[];
    writePatterns: string[];
    listPatterns: string[];
  }> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    const agent = matches[0] as any;
    const [allEntries, accessPatterns] = await Promise.all([
      listCachedWorkspaceFiles(this.workspaceRoot),
      this.permRegistry.loadAsync(id),
    ]);
    const allFiles = allEntries.filter((e) => !e.isDirectory).map((e) => e.relativePath);
    const annotated = this.fileAnnotationService.getAnnotatedFiles(
      this.workspaceRoot,
      agent.permissions,
      allFiles
    );
    const withAccess = annotated.filter((f) => f.readable || f.listable || f.writable);
    return {
      files: withAccess,
      readPatterns: accessPatterns.read ?? [],
      writePatterns: accessPatterns.write ?? [],
      listPatterns: accessPatterns.list ?? [],
    };
  }

  async generateHandoffPrompt(id: string): Promise<{ prompt: string }> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return { prompt: '' };
  }

  async getSlashCommands(id: string): Promise<ChatCommandRegistryEntry[]> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    return [];
  }

  async introduction(
    id: string,
    query?: { developerName?: string }
  ): Promise<{ agentId: string; content: string; timestamp: string }> {
    const matches = await this.agentManager.resolveAgentAsync(id);
    if (matches.length === 0) throw new NotFoundError(`No agent matching "${id}"`);
    const agent = matches[0] as any;
    const content = this.introductionRenderer.render(agent, query?.developerName);
    return { agentId: agent.id, content, timestamp: new Date().toISOString() };
  }
}

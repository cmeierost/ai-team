import {
  IAgentDocumentStorage,
  IMarkdownSectionService,
  IWorkspaceStorage,
  IWorkspaceDiscoveryStorage,
  Agent,
  AgentSchema,
  ValidationError,
  FileNotFoundError,
  Skill,
  SkillSchema,
  AgentSkillFile,
  AgentSkillFileSchema,
  InstructionFile,
  MarkdownSection,
  AgentMarkdownParts,
} from '@ai-team/core';
import matter from 'gray-matter';
import fs from 'node:fs/promises';
import path from 'node:path';

export class AgentDocumentStorage implements IAgentDocumentStorage {
  constructor(
    private readonly workspaceRoot: string,
    private readonly markdownSectionService: IMarkdownSectionService,
    private readonly workspaceStorage: IWorkspaceStorage,
    private readonly workspaceDiscoveryStorage: IWorkspaceDiscoveryStorage
  ) {}

  public buildAgentMarkdown(parts: AgentMarkdownParts): string {
    return this.markdownSectionService.buildAgentMarkdown(parts);
  }

  private hashStringToHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (str.codePointAt(i) ?? 0) + ((hash << 5) - hash);
    }
    return Math.abs(hash % 360);
  }

  private generateAgentColor(agent: Pick<Agent, 'name' | 'avatar'>): string {
    if (agent.avatar?.color) return agent.avatar.color;
    const seed = agent.avatar?.seed || agent.name;
    const hue = this.hashStringToHue(seed);
    return `hsl(${hue}, 70%, 60%)`;
  }

  public async loadAgentAsync(filePath: string): Promise<Agent> {
    try {
      const markdownPath = this.isYamlAgentFile(filePath)
        ? await this.firstExistingPathAsync(this.getMarkdownSidecarCandidates(filePath))
        : filePath;

      const metadataPath = this.isYamlAgentFile(filePath)
        ? filePath
        : await this.firstExistingPathAsync(this.getMetadataSidecarCandidates(filePath));

      const markdownRecord = markdownPath
        ? await this.readMarkdownAgentFileAsync(markdownPath)
        : { data: {}, markdown: '' };

      const metadataRecord = metadataPath
        ? this.parseYamlSidecar(await fs.readFile(metadataPath, 'utf-8'), metadataPath)
        : {};

      const config = AgentSchema.parse({
        ...markdownRecord.data,
        ...metadataRecord,
      });

      const explicitId = this.normalizeText(config.id);
      const explicitName = this.normalizeText(config.name);
      const explicitAiTeamId = this.normalizeText(config.aiTeamId);
      const explicitAiTeamName = this.normalizeText(config.aiTeamName);

      const identityPath = markdownPath || metadataPath || filePath;
      const fallbackFileId =
        this.isDotAgentFile(identityPath) || this.isAgentMdFile(identityPath)
          ? this.fileNameToAgentId(identityPath)
          : undefined;

      const hasExplicitIdentity = Boolean(
        explicitId || explicitName || explicitAiTeamId || explicitAiTeamName
      );

      if (!hasExplicitIdentity && !fallbackFileId) {
        throw new ValidationError(
          `Agent identity missing in ${identityPath}. Provide one of name, id, legacy aiTeamName, legacy aiTeamId, or use *.agent.md filename.`
        );
      }

      const effectiveId =
        explicitId ||
        explicitAiTeamId ||
        this.slugifyName(explicitName || explicitAiTeamName || fallbackFileId || '');

      if (!effectiveId) {
        throw new ValidationError(`Unable to resolve agent id for ${filePath}`);
      }

      const effectiveName = explicitName || explicitAiTeamName || this.humanizeId(effectiveId);
      const skillPath = path.join(path.dirname(identityPath), `${config.role}.md`);
      const stats = await fs.stat(metadataPath || markdownPath || filePath);

      return {
        ...config,
        id: effectiveId,
        name: effectiveName,
        aiTeamId: effectiveId,
        aiTeamName: effectiveName,
        filePath: markdownPath || metadataPath || filePath,
        skillPath,
        markdown: markdownRecord.markdown,
        createdAt: stats.birthtime.toISOString(),
        lastInteraction: stats.mtime.toISOString(),
        avatar: {
          ...config.avatar,
          type: config.avatar?.type ?? 'initials',
          color:
            config.avatar?.color ??
            this.generateAgentColor({ name: effectiveName, avatar: config.avatar }),
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(filePath);
      }
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError(`Invalid agent configuration in ${filePath}`, error);
      }
      throw error;
    }
  }

  public async saveAgentAsync(agent: Agent): Promise<void> {
    AgentSchema.parse(agent);

    const idToName = (id: string) =>
      id
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    const manualHandoffs = (agent.handoffs || []).filter((h) => !h.label.startsWith('[auto]'));
    const manualTargetAgents = new Set(manualHandoffs.map((h) => h.agent));
    const autoHandoffs: NonNullable<Agent['handoffs']> = [];

    if (agent.reportsTo && !manualTargetAgents.has(agent.reportsTo)) {
      autoHandoffs.push({
        label: `[auto] Report to ${idToName(agent.reportsTo)}`,
        agent: agent.reportsTo,
        prompt: 'Please take this on within your area of responsibility.',
      });
    }

    for (const delegatee of agent.delegatesTo || []) {
      if (!manualTargetAgents.has(delegatee)) {
        autoHandoffs.push({
          label: `[auto] Delegate to ${idToName(delegatee)}`,
          agent: delegatee,
          prompt: 'Please take this on within your area of responsibility.',
        });
      }
    }

    const syncedAgent: Agent = {
      ...agent,
      handoffs: [...manualHandoffs, ...autoHandoffs],
    };

    const {
      filePath: _filePath,
      skillPath: _skillPath,
      createdAt: _createdAt,
      lastInteraction: _lastInteraction,
      conversationCount: _conversationCount,
      status: _status,
      markdown,
      ...frontmatter
    } = syncedAgent;

    const cleanFrontmatter = Object.fromEntries(
      Object.entries(frontmatter).filter(([k, v]) => {
        if (v === undefined) return false;
        if (k === 'aiTeamId' && v === frontmatter.id) return false;
        if (k === 'aiTeamName' && v === frontmatter.name) return false;
        return true;
      })
    );

    const targetFilePath = this.isYamlAgentFile(agent.filePath)
      ? this.getMarkdownSidecarCandidates(agent.filePath)[0] ||
        agent.filePath.replace(/\.ya?ml$/, '.md')
      : agent.filePath;

    const body = (markdown || '').trim();

    let syncedBody = body;
    if (agent.handoffs && agent.handoffs.length > 0) {
      const handoffLines = agent.handoffs.map((h) => {
        const promptSuffix = h.prompt ? `: ${h.prompt.trim()}` : '';
        return `- **${h.label}** → \`${h.agent}\`${promptSuffix}`;
      });
      const handoffContent = [
        'When a task falls outside your scope, guide the user to the right agent using `/agent` in Copilot CLI or the handoff buttons in VS Code.',
        '',
        ...handoffLines,
      ].join('\n');
      syncedBody = this.markdownSectionService.replaceOrAppendMarkdownSection(
        syncedBody,
        'Handoffs',
        handoffContent
      );
    } else {
      const sections = this.markdownSectionService.parseMarkdownSections(syncedBody);
      const filtered = sections.filter((s) => s.heading !== 'Handoffs');
      if (filtered.length !== sections.length) {
        syncedBody = this.sectionsToMarkdown(filtered);
      }
    }

    const content = matter.stringify(syncedBody ? `\n${syncedBody}\n` : '', cleanFrontmatter);

    await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
    await fs.writeFile(targetFilePath, content, 'utf-8');

    const sidecars = this.getMetadataSidecarCandidates(targetFilePath);
    for (const sidecar of sidecars) {
      try {
        await fs.unlink(sidecar);
      } catch {
        // Ignore missing sidecars
      }
    }
  }

  public async loadSkillAsync(filePath: string): Promise<Skill> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data, content: markdown } = matter(content);
        const config = SkillSchema.parse(data);

      return {
        filePath,
        instructions: markdown.trim(),
        ...config,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(filePath);
      }
      if (error instanceof Error && error.name === 'YAMLException') {
        throw new ValidationError(
          `Invalid YAML frontmatter in ${filePath}: ${error.message}`,
          error
        );
      }
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError(`Invalid skill configuration in ${filePath}`, error);
      }
      throw error;
    }
  }

  public async saveSkillAsync(skill: Skill): Promise<void> {
    SkillSchema.parse(skill);

    const { filePath: _filePath, instructions, ...frontmatter } = skill;
    const content = matter.stringify(instructions, frontmatter);

    await fs.mkdir(path.dirname(skill.filePath), { recursive: true });
    await fs.writeFile(skill.filePath, content, 'utf-8');
  }

  public async loadAgentSkillFileAsync(filePath: string): Promise<AgentSkillFile> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data, content: markdown } = matter(content);
      const config = AgentSkillFileSchema.parse(data);
      return {
        filePath,
        name: config.name,
        description: config.description,
        triggers: config.triggers,
        instructions: markdown.trim(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileNotFoundError(filePath);
      }
      if (error instanceof Error && error.name === 'YAMLException') {
        throw new ValidationError(
          `Invalid YAML frontmatter in ${filePath}: ${error.message}`,
          error
        );
      }
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError(`Invalid skill file configuration in ${filePath}`, error);
      }
      throw error;
    }
  }

  public async loadInstructionFileAsync(filePath: string): Promise<InstructionFile> {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data, content: markdown } = matter(content);
    const applyTo = typeof data.applyTo === 'string' ? data.applyTo : '**';
    return {
      filePath,
      applyTo,
      instructions: markdown.trim(),
    };
  }

  public async loadAllInstructionFilesAsync(): Promise<InstructionFile[]> {
    const filePaths = await this.workspaceDiscoveryStorage.findInstructionFilesAsync();
    const results: InstructionFile[] = [];
    for (const fp of filePaths) {
      try {
        const inst = await this.loadInstructionFileAsync(fp);
        results.push(inst);
      } catch (error) {
        console.error(`Failed to load instruction file ${fp}:`, error);
      }
    }

    return results;
  }

  private normalizeText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private slugifyName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private fileNameToAgentId(filePath: string): string {
    const base = path.basename(filePath).toLowerCase();
    if (base === 'agent.md') return path.basename(path.dirname(filePath));
    if (base.endsWith('.agent.md')) return path.basename(filePath, '.agent.md');
    return path.basename(filePath, '.md');
  }

  private isDotAgentFile(filePath: string): boolean {
    return path.basename(filePath).toLowerCase().endsWith('.agent.md');
  }

  private isAgentMdFile(filePath: string): boolean {
    return path.basename(filePath).toLowerCase() === 'agent.md';
  }

  private isDotAgentYamlFile(filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();
    return base.endsWith('.agent.yml') || base.endsWith('.agent.yaml');
  }

  private isAgentYamlFile(filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();
    return base === 'agent.yml' || base === 'agent.yaml';
  }

  private isYamlAgentFile(filePath: string): boolean {
    return this.isDotAgentYamlFile(filePath) || this.isAgentYamlFile(filePath);
  }

  private getMetadataSidecarCandidates(filePath: string): string[] {
    const lowerBase = path.basename(filePath).toLowerCase();
    if (lowerBase === 'agent.md') {
      return [
        path.join(path.dirname(filePath), 'agent.yml'),
        path.join(path.dirname(filePath), 'agent.yaml'),
      ];
    }

    if (lowerBase.endsWith('.agent.md')) {
      return [filePath.slice(0, -3) + '.yml', filePath.slice(0, -3) + '.yaml'];
    }

    return [];
  }

  private getMarkdownSidecarCandidates(filePath: string): string[] {
    const lowerBase = path.basename(filePath).toLowerCase();
    if (lowerBase === 'agent.yml' || lowerBase === 'agent.yaml') {
      return [path.join(path.dirname(filePath), 'agent.md')];
    }

    if (lowerBase.endsWith('.agent.yml')) return [filePath.slice(0, -4) + '.md'];
    if (lowerBase.endsWith('.agent.yaml')) return [filePath.slice(0, -5) + '.md'];

    return [];
  }

  private async firstExistingPathAsync(paths: string[]): Promise<string | undefined> {
    for (const candidate of paths) {
      if (await this.workspaceStorage.fileExistsAsync(candidate)) return candidate;
    }
    return undefined;
  }

  private parseYamlSidecar(content: string, filePath: string): Record<string, unknown> {
    const wrapped = `---\n${content.trim()}\n---\n`;
    const { data } = matter(wrapped);

    if (content.trim().length > 0 && Object.keys(data).length === 0) {
      throw new ValidationError(`Invalid agent YAML metadata in ${filePath}`);
    }

    return data;
  }

  private async readMarkdownAgentFileAsync(
    filePath: string
  ): Promise<{ data: Record<string, unknown>; markdown: string }> {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data, content: markdown } = matter(content);

    if (content.trimStart().startsWith('---') && Object.keys(data).length === 0) {
      throw new ValidationError(
        `Invalid agent configuration in ${filePath}: YAML frontmatter appears to be missing its closing --- delimiter.`
      );
    }

    return { data: data, markdown };
  }

  private humanizeId(id: string): string {
    return id
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private sectionsToMarkdown(sections: MarkdownSection[]): string {
    const parts: string[] = [];
    for (const section of sections) {
      if (section.heading === '') {
        if (section.content) parts.push(section.content);
      } else {
        parts.push(`## ${section.heading}\n${section.content}`);
      }
    }

    return parts.join('\n\n') + '\n';
  }
}

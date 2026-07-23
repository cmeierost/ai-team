import type {
  ICommand,
  ISkillManager,
  IEmitService,
  ISessionManager,
  IToolManager,
} from '@ai-team/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { glob } from 'glob/raw';
import type { ChatCommandRegistryEntry } from '@ai-team/api-contracts';
import { JsonWorkflowSchema } from '../../workflow/json-workflow-tool.js';
import type { DynamicSlashCatalogConfigInput } from './config.js';

export interface DynamicSlashCatalogOptions {
  workspaceRoot: string;
  skillManager: ISkillManager;
  reservedKeys?: Iterable<string>;
  dynamicSlashCatalog?: DynamicSlashCatalogConfigInput;
}

export interface DynamicSlashEntry {
  key: string;
  usage: string;
  name: string;
  description: string;
  filePath: string;
  instructions: string;
  source: 'skill' | 'prompt' | 'workflow';
  modifiedAtMs: number;
}

export interface DynamicSlashCatalog {
  entries: DynamicSlashEntry[];
  warnings: string[];
}

interface CandidateRecord {
  entry: DynamicSlashEntry;
  index: number;
}

interface PromptFrontmatter {
  name?: unknown;
  description?: unknown;
}

interface ResolvedDynamicSlashGlobs {
  promptGlobs: string[];
  skillGlobs: string[];
  workflowGlobs: string[];
}

export class DynamicSlashKeyNormalizer {
  normalize(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^-+|-+$/g, '');
  }
}

export class DynamicSlashCatalogService {
  static readonly DEFAULT_PROMPT_GLOBS = [
    '.ai-team/prompts/**/*.prompt.md',
    '.github/prompts/**/*.prompt.md',
  ];

  static readonly DEFAULT_SKILL_GLOBS = [
    '.ai-team/skills/**/SKILL.md',
    '.github/skills/**/SKILL.md',
  ];

  static readonly DEFAULT_WORKFLOW_GLOBS = ['.ai-team/workflows/**/*.json'];

  private readonly normalizer = new DynamicSlashKeyNormalizer();

  constructor(private readonly options: DynamicSlashCatalogOptions) {}

  async buildAsync(): Promise<DynamicSlashCatalog> {
    const globs = this.resolveDynamicSlashGlobs(this.options.dynamicSlashCatalog);
    const reserved = new Set<string>(
      Array.from(this.options.reservedKeys ?? []).map((key) => key.toLowerCase())
    );
    const warnings: string[] = [];
    const candidates: CandidateRecord[] = [];

    const [skillEntries, promptEntries, workflowEntries] = await Promise.all([
      this.loadSkillEntries(globs.skillGlobs),
      this.loadPromptEntries(globs.promptGlobs),
      this.loadWorkflowEntries(globs.workflowGlobs),
    ]);

    let index = 0;
    for (const entry of [...skillEntries, ...promptEntries, ...workflowEntries]) {
      candidates.push({ entry, index });
      index += 1;
    }

    candidates.sort((left, right) => {
      if (left.entry.modifiedAtMs !== right.entry.modifiedAtMs) {
        return left.entry.modifiedAtMs - right.entry.modifiedAtMs;
      }
      return left.index - right.index;
    });

    for (const candidate of candidates) {
      const key = candidate.entry.key.toLowerCase();
      if (!key) continue;

      const resolvedKey = this.resolveAvailableKey(key, candidate.entry.source, reserved);
      if (resolvedKey !== key) {
        warnings.push(
          `[slash] ${candidate.entry.source} "${candidate.entry.name}" uses /${resolvedKey} because /${key} is reserved.`
        );
      }
      candidate.entry.key = resolvedKey;
      candidate.entry.usage = `/${resolvedKey}`;
      reserved.add(resolvedKey);
    }

    const entries = candidates
      .map((candidate) => candidate.entry)
      .sort((a, b) => a.key.localeCompare(b.key));

    return { entries, warnings };
  }

  private resolveAvailableKey(
    requestedKey: string,
    source: DynamicSlashEntry['source'],
    reserved: Set<string>
  ): string {
    if (!reserved.has(requestedKey)) return requestedKey;

    const base = `${source}-${requestedKey}`;
    let candidate = base;
    let suffix = 2;
    while (reserved.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private async loadSkillEntries(skillGlobs: string[]): Promise<DynamicSlashEntry[]> {
    const allowedSkillFiles = await this.collectMatchedFiles(skillGlobs);
    const skills = await this.options.skillManager.getAllSkills();
    const entries: DynamicSlashEntry[] = [];

    for (const skill of skills) {
      if (allowedSkillFiles.size > 0 && !allowedSkillFiles.has(path.resolve(skill.filePath))) {
        continue;
      }

      const key = this.normalizer.normalize(skill.name);
      if (!key) continue;

      const modifiedAtMs = await this.getMtimeMs(skill.filePath);
      const description =
        this.normalizeDescription(skill.description) ??
        this.fallbackDescription(skill.instructions) ??
        `Load skill ${skill.name}`;

      entries.push({
        key,
        usage: `/${key}`,
        name: skill.name,
        description,
        filePath: skill.filePath,
        instructions: skill.instructions,
        source: 'skill',
        modifiedAtMs,
      });
    }

    return entries;
  }

  private async loadPromptEntries(promptGlobs: string[]): Promise<DynamicSlashEntry[]> {
    const fileGroups = await Promise.all(
      promptGlobs.map((pattern) =>
        glob(pattern, {
          cwd: this.options.workspaceRoot,
          absolute: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      )
    );

    const files = Array.from(new Set(fileGroups.flat()));
    const entries: DynamicSlashEntry[] = [];

    for (const filePath of files) {
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = matter(raw);
        const frontmatter = parsed.data as PromptFrontmatter;
        const inferredName = this.inferPromptName(filePath, frontmatter.name);
        const key = this.normalizer.normalize(inferredName);
        if (!key) {
          continue;
        }

        const instructions = parsed.content.trim();
        const description =
          this.normalizeDescription(frontmatter.description) ??
          this.fallbackDescription(instructions) ??
          `Load prompt ${inferredName}`;
        const modifiedAtMs = await this.getMtimeMs(filePath);

        entries.push({
          key,
          usage: `/${key}`,
          name: inferredName,
          description,
          filePath,
          instructions,
          source: 'prompt',
          modifiedAtMs,
        });
      } catch {
        // ignore malformed prompt files from dynamic slash catalog generation
      }
    }

    return entries;
  }

  private async loadWorkflowEntries(workflowGlobs: string[]): Promise<DynamicSlashEntry[]> {
    const fileGroups = await Promise.all(
      workflowGlobs.map((pattern) =>
        glob(pattern, {
          cwd: this.options.workspaceRoot,
          absolute: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      )
    );
    const files = Array.from(new Set(fileGroups.flat()));

    const entries: DynamicSlashEntry[] = [];

    for (const filePath of files) {
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        const result = JsonWorkflowSchema.safeParse(parsed);
        if (!result.success) {
          continue;
        }

        const workflow = result.data;
        const key = this.normalizer.normalize(workflow.id || workflow.name);
        if (!key) {
          continue;
        }

        const modifiedAtMs = await this.getMtimeMs(filePath);
        entries.push({
          key,
          usage: `/${key}`,
          name: `workflow_${workflow.id}`,
          description:
            this.normalizeDescription(workflow.description) ?? `Run workflow ${workflow.name}`,
          filePath,
          instructions: '',
          source: 'workflow',
          modifiedAtMs,
        });
      } catch {
        // ignore malformed workflow files from dynamic slash catalog generation
      }
    }

    return entries;
  }

  private resolveDynamicSlashGlobs(
    config?: DynamicSlashCatalogConfigInput
  ): ResolvedDynamicSlashGlobs {
    return {
      promptGlobs: this.sanitizeGlobs(
        config?.promptGlobs,
        DynamicSlashCatalogService.DEFAULT_PROMPT_GLOBS
      ),
      skillGlobs: this.sanitizeGlobs(
        config?.skillGlobs,
        DynamicSlashCatalogService.DEFAULT_SKILL_GLOBS
      ),
      workflowGlobs: this.sanitizeGlobs(
        config?.workflowGlobs,
        DynamicSlashCatalogService.DEFAULT_WORKFLOW_GLOBS
      ),
    };
  }

  private sanitizeGlobs(configured: string[] | undefined, fallback: string[]): string[] {
    const globs = configured?.map((globPattern) => globPattern.trim()).filter(Boolean);
    return globs && globs.length > 0 ? globs : fallback;
  }

  private async collectMatchedFiles(patterns: string[]): Promise<Set<string>> {
    const fileGroups = await Promise.all(
      patterns.map((pattern) =>
        glob(pattern, {
          cwd: this.options.workspaceRoot,
          absolute: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      )
    );

    return new Set(fileGroups.flat().map((filePath) => path.resolve(filePath)));
  }

  private async getMtimeMs(filePath: string): Promise<number> {
    try {
      const stat = await fs.stat(filePath);
      return stat.mtimeMs;
    } catch {
      return 0;
    }
  }

  private normalizeDescription(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private fallbackDescription(text: string): string | undefined {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const normalized = line.replace(/^#+\s*/, '').trim();
      if (!normalized) continue;
      return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
    }
    return undefined;
  }

  private inferPromptName(filePath: string, frontmatterName: unknown): string {
    if (typeof frontmatterName === 'string' && frontmatterName.trim().length > 0) {
      return frontmatterName.trim();
    }

    const baseName = path.basename(filePath);
    return baseName.replace(/\.prompt\.md$/i, '').replace(/\.md$/i, '');
  }

  private toWorkspaceRelative(absolutePath: string): string {
    return path.relative(this.options.workspaceRoot, absolutePath).replaceAll('\\', '/');
  }
}

export class DynamicSlashCommandFactory {
  private readonly normalizer = new DynamicSlashKeyNormalizer();

  constructor(
    private readonly workspaceRoot: string,
    private readonly emitService: IEmitService,
    private readonly sessionManager: Pick<
      ISessionManager,
      'addSessionSkill' | 'setSessionSkillPaused'
    >,
    private readonly toolManager: Pick<IToolManager, 'execute'>
  ) {}

  buildCommands(entries: DynamicSlashEntry[]): ICommand<string, unknown>[] {
    this.assertUniqueDynamicSlashEntries(entries, 'buildDynamicSlashCommands');
    return entries.map((entry) => this.buildCommand(entry));
  }

  buildCommand(entry: DynamicSlashEntry): ICommand<string, unknown> {
    if (entry.source === 'skill') {
      return this.buildSkillSlashCommand(entry);
    }
    if (entry.source === 'prompt') {
      return this.buildPromptSlashCommand(entry);
    }
    return this.buildWorkflowSlashCommand(entry);
  }

  toChatCommandRegistryEntries(entries: DynamicSlashEntry[]): ChatCommandRegistryEntry[] {
    this.assertUniqueDynamicSlashEntries(entries, 'toDynamicChatCommandRegistryEntries');
    return entries.map((entry) => ({
      key: entry.key,
      usage: entry.usage,
      description: entry.description,
      aliases: undefined,
      availableIn: { chat: true, tool: false, cli: false },
      path: ['dynamic', entry.source],
      help: undefined,
      llm: undefined,
      intents: undefined,
      intentExamples: undefined,
      input: undefined,
    }));
  }

  private buildSkillSlashCommand(entry: DynamicSlashEntry): ICommand<string, unknown> {
    return {
      metadata: {
        key: entry.key,
        usage: entry.usage,
        description: entry.description,
        availableIn: { chat: true, tool: false, cli: false },
        group: 'chat',
      },
      execute: async (_args, ctx) => {
        if (!ctx.sessionId) {
          throw new Error('Session ID is required for skill commands');
        }
        const relativeSkillPath = this.toWorkspaceRelative(entry.filePath);
        await this.sessionManager.addSessionSkill(ctx.sessionId, relativeSkillPath);
        await this.sessionManager.setSessionSkillPaused(ctx.sessionId, relativeSkillPath, false);

        this.emitService.log(
          'info',
          `[skills] Loaded ${entry.name}. Active on next turns in this session.`
        );

        return {
          status: 'ok',
          message: `Loaded skill "${entry.name}".`,
          data: {
            source: 'skill',
            name: entry.name,
            key: entry.key,
            path: relativeSkillPath,
          },
        };
      },
    };
  }

  private buildWorkflowSlashCommand(entry: DynamicSlashEntry): ICommand<string, unknown> {
    return {
      metadata: {
        key: entry.key,
        usage: entry.usage,
        description: entry.description,
        availableIn: { chat: true, tool: false, cli: false },
        group: 'chat',
      },
      execute: async (_args, ctx) => {
        const toolName = entry.name;
        const result = await this.toolManager.execute(
          ctx.agent!,
          toolName,
          {},
          {
            agentId: ctx.agent!.id,
            history: [],
          }
        );

        if (!result.ok) {
          return {
            status: 'error',
            message: result.error ?? `Workflow '${entry.name}' failed.`,
            error: {
              code: 'WORKFLOW_EXECUTION_FAILED',
              message: result.error ?? `Workflow '${entry.name}' failed.`,
              details: { toolName, key: entry.key },
            },
          };
        }

        this.emitService.log('info', `[workflow] Executed ${entry.name} (${toolName}).`);

        return {
          status: 'ok',
          message: `Executed workflow '${entry.name}'.`,
          data: {
            source: 'workflow',
            name: entry.name,
            key: entry.key,
            toolName,
            result: result.result,
          },
        };
      },
    };
  }

  private buildPromptSlashCommand(entry: DynamicSlashEntry): ICommand<string, unknown> {
    return {
      metadata: {
        key: entry.key,
        usage: entry.usage,
        description: entry.description,
        availableIn: { chat: true, tool: false, cli: false },
        group: 'chat',
      },
      execute: async () => {
        const header = `# Prompt: ${entry.name}`;
        const payload = [header, entry.instructions].filter(Boolean).join('\n\n').trim();
        this.emitService.log('info', payload);

        return {
          status: 'ok',
          message: `Loaded prompt "${entry.name}".`,
          data: {
            source: 'prompt',
            name: entry.name,
            key: entry.key,
            promptText: entry.instructions,
            rendered: payload,
          },
          saveable: payload,
        };
      },
    };
  }

  private assertUniqueDynamicSlashEntries(entries: DynamicSlashEntry[], caller: string): void {
    const seen = new Set<string>();

    for (const entry of entries) {
      const key = this.normalizer.normalize(entry.key);
      if (!key) {
        throw new Error(`[slash] ${caller}: encountered dynamic slash entry with empty key.`);
      }

      if (entry.key !== key) {
        throw new Error(
          `[slash] ${caller}: entry key '${entry.key}' is not normalized. Use '${key}'.`
        );
      }

      if (seen.has(key)) {
        throw new Error(`[slash] ${caller}: duplicate dynamic slash key '/${key}'.`);
      }

      seen.add(key);
    }
  }

  private toWorkspaceRelative(absolutePath: string): string {
    return path.relative(this.workspaceRoot, absolutePath).replaceAll('\\', '/');
  }
}

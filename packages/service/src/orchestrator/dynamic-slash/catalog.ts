import type { ICommand, ISkillManager } from '@ai-team/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { glob } from 'glob/raw';
import type { ChatCommandRegistryEntry } from '@ai-team/api-contracts';
import { emitLog } from '../stream-events.js';
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

export const DEFAULT_PROMPT_GLOBS = [
  '.ai-team/prompts/**/*.prompt.md',
  '.github/prompts/**/*.prompt.md',
];
export const DEFAULT_SKILL_GLOBS = ['.ai-team/skills/**/SKILL.md', '.github/skills/**/SKILL.md'];
export const DEFAULT_WORKFLOW_GLOBS = ['.ai-team/workflows/**/*.json'];

interface ResolvedDynamicSlashGlobs {
  promptGlobs: string[];
  skillGlobs: string[];
  workflowGlobs: string[];
}

export function normalizeSlashKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

export async function buildDynamicSlashCatalog(
  options: DynamicSlashCatalogOptions
): Promise<DynamicSlashCatalog> {
  const globs = resolveDynamicSlashGlobs(options.dynamicSlashCatalog);
  const reserved = new Set<string>(
    Array.from(options.reservedKeys ?? []).map((key) => key.toLowerCase())
  );
  const warnings: string[] = [];
  const candidates: CandidateRecord[] = [];

  const [skillEntries, promptEntries, workflowEntries] = await Promise.all([
    loadSkillEntries(options.workspaceRoot, options.skillManager, globs.skillGlobs),
    loadPromptEntries(options.workspaceRoot, globs.promptGlobs),
    loadWorkflowEntries(options.workspaceRoot, globs.workflowGlobs),
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

  const winnerByKey = new Map<string, CandidateRecord>();

  for (const candidate of candidates) {
    const key = candidate.entry.key;
    if (!key) continue;

    if (reserved.has(key)) {
      warnings.push(
        `[slash] ${candidate.entry.source} "${candidate.entry.name}" conflicts with built-in /${key}; built-in command wins.`
      );
      continue;
    }

    const existing = winnerByKey.get(key);
    if (!existing) {
      winnerByKey.set(key, candidate);
      continue;
    }

    const nextWins =
      candidate.entry.modifiedAtMs > existing.entry.modifiedAtMs ||
      (candidate.entry.modifiedAtMs === existing.entry.modifiedAtMs &&
        candidate.index > existing.index);

    if (nextWins) {
      warnings.push(
        `[slash] Duplicate ${candidate.entry.source} key /${key}: using newer "${candidate.entry.name}" from ${toWorkspaceRelative(options.workspaceRoot, candidate.entry.filePath)}; replaced "${existing.entry.name}".`
      );
      winnerByKey.set(key, candidate);
    } else {
      warnings.push(
        `[slash] Duplicate ${candidate.entry.source} key /${key}: keeping newer "${existing.entry.name}"; ignored "${candidate.entry.name}".`
      );
    }
  }

  const entries = Array.from(winnerByKey.values())
    .map((record) => record.entry)
    .sort((a, b) => a.key.localeCompare(b.key));

  return { entries, warnings };
}

export function buildDynamicSlashCommands(
  entries: DynamicSlashEntry[]
): ICommand<string, unknown>[] {
  assertUniqueDynamicSlashEntries(entries, 'buildDynamicSlashCommands');
  return entries.map((entry) => {
    if (entry.source === 'skill') {
      return buildSkillSlashCommand(entry);
    }
    if (entry.source === 'workflow') {
      return buildWorkflowSlashCommand(entry);
    }
    return buildPromptSlashCommand(entry);
  });
}

export function toDynamicChatCommandRegistryEntries(
  entries: DynamicSlashEntry[]
): ChatCommandRegistryEntry[] {
  assertUniqueDynamicSlashEntries(entries, 'toDynamicChatCommandRegistryEntries');
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

async function loadSkillEntries(
  workspaceRoot: string,
  skillManager: ISkillManager,
  skillGlobs: string[]
): Promise<DynamicSlashEntry[]> {
  const allowedSkillFiles = await collectMatchedFiles(workspaceRoot, skillGlobs);
  const skills = await skillManager.getAllSkills();
  const entries: DynamicSlashEntry[] = [];

  for (const skill of skills) {
    if (allowedSkillFiles.size > 0 && !allowedSkillFiles.has(path.resolve(skill.filePath))) {
      continue;
    }

    const key = normalizeSlashKey(skill.name);
    if (!key) continue;

    const modifiedAtMs = await getMtimeMs(skill.filePath);
    const description =
      normalizeDescription(skill.description) ??
      fallbackDescription(skill.instructions) ??
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

async function loadPromptEntries(
  workspaceRoot: string,
  promptGlobs: string[]
): Promise<DynamicSlashEntry[]> {
  const fileGroups = await Promise.all(
    promptGlobs.map((pattern) =>
      glob(pattern, {
        cwd: workspaceRoot,
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
      const inferredName = inferPromptName(filePath, frontmatter.name);
      const key = normalizeSlashKey(inferredName);
      if (!key) continue;

      const instructions = parsed.content.trim();
      const description =
        normalizeDescription(frontmatter.description) ??
        fallbackDescription(instructions) ??
        `Load prompt ${inferredName}`;
      const modifiedAtMs = await getMtimeMs(filePath);

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

function buildSkillSlashCommand(entry: DynamicSlashEntry): ICommand<string, unknown> {
  return {
    key: entry.key,
    usage: entry.usage,
    description: entry.description,
    availableIn: { chat: true, tool: false, cli: false },
    group: 'chat',
    execute: async (_args, ctx) => {
      const relativeSkillPath = toWorkspaceRelative(ctx.workspaceRoot, entry.filePath);
      await (ctx as any).sessionManager.addSessionSkill(ctx.sessionId, relativeSkillPath);
      await (ctx as any).sessionManager.setSessionSkillPaused(
        ctx.sessionId,
        relativeSkillPath,
        false
      );

      emitLog(
        (ctx as any).hooks,
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

function buildPromptSlashCommand(entry: DynamicSlashEntry): ICommand<string, unknown> {
  return {
    key: entry.key,
    usage: entry.usage,
    description: entry.description,
    availableIn: { chat: true, tool: false, cli: false },
    group: 'chat',
    execute: async (_args, ctx) => {
      const header = `# Prompt: ${entry.name}`;
      const payload = [header, entry.instructions].filter(Boolean).join('\n\n').trim();
      emitLog((ctx as any).hooks, 'info', payload);

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

async function getMtimeMs(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

function inferPromptName(filePath: string, frontmatterName: unknown): string {
  if (typeof frontmatterName === 'string' && frontmatterName.trim().length > 0) {
    return frontmatterName.trim();
  }

  const baseName = path.basename(filePath);
  return baseName.replace(/\.prompt\.md$/i, '').replace(/\.md$/i, '');
}

function normalizeDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function fallbackDescription(text: string): string | undefined {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const normalized = line.replace(/^#+\s*/, '').trim();
    if (!normalized) continue;
    return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
  }
  return undefined;
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replaceAll('\\', '/');
}

function assertUniqueDynamicSlashEntries(entries: DynamicSlashEntry[], caller: string): void {
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = normalizeSlashKey(entry.key);
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

async function loadWorkflowEntries(
  workspaceRoot: string,
  workflowGlobs: string[]
): Promise<DynamicSlashEntry[]> {
  const fileGroups = await Promise.all(
    workflowGlobs.map((pattern) =>
      glob(pattern, {
        cwd: workspaceRoot,
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
      const key = normalizeSlashKey(workflow.id || workflow.name);
      if (!key) {
        continue;
      }

      const modifiedAtMs = await getMtimeMs(filePath);
      entries.push({
        key,
        usage: `/${key}`,
        name: `workflow_${workflow.id}`,
        description: normalizeDescription(workflow.description) ?? `Run workflow ${workflow.name}`,
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

function buildWorkflowSlashCommand(entry: DynamicSlashEntry): ICommand<string, unknown> {
  return {
    key: entry.key,
    usage: entry.usage,
    description: entry.description,
    availableIn: { chat: true, tool: false, cli: false },
    group: 'chat',
    execute: async (_args, ctx) => {
      const toolName = entry.name;

      const result = await (ctx as any).toolManager.execute(
        ctx.agent!,
        toolName,
        {},
        {
          agentId: ctx.agent!.id,
          workspaceRoot: ctx.workspaceRoot,
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

      emitLog((ctx as any).hooks, 'info', `[workflow] Executed ${entry.name} (${toolName}).`);

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

function resolveDynamicSlashGlobs(
  config?: DynamicSlashCatalogConfigInput
): ResolvedDynamicSlashGlobs {
  return {
    promptGlobs: sanitizeGlobs(config?.promptGlobs, DEFAULT_PROMPT_GLOBS),
    skillGlobs: sanitizeGlobs(config?.skillGlobs, DEFAULT_SKILL_GLOBS),
    workflowGlobs: sanitizeGlobs(config?.workflowGlobs, DEFAULT_WORKFLOW_GLOBS),
  };
}

function sanitizeGlobs(configured: string[] | undefined, fallback: string[]): string[] {
  const globs = configured?.map((globPattern) => globPattern.trim()).filter(Boolean);
  return globs && globs.length > 0 ? globs : fallback;
}

async function collectMatchedFiles(
  workspaceRoot: string,
  patterns: string[]
): Promise<Set<string>> {
  const fileGroups = await Promise.all(
    patterns.map((pattern) =>
      glob(pattern, {
        cwd: workspaceRoot,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      })
    )
  );

  return new Set(fileGroups.flat().map((filePath) => path.resolve(filePath)));
}

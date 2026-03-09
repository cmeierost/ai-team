/**
 * Storage utilities for reading/writing agent and skill files
 * All files use YAML frontmatter + Markdown body format
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { glob } from 'glob';
import {
  Agent,
  Skill,
  AgentSchema,
  SkillSchema,
  AgentConfig,
  SkillConfig,
  TeamConfig,
  TeamConfigSchema,
  FileNotFoundError,
  ValidationError,
} from '../types/index.js';
import { generateAgentColor } from '../avatar/index.js';

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function fileNameToAgentId(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'agent.md') {
    return path.basename(path.dirname(filePath));
  }
  if (base.endsWith('.agent.md')) {
    return path.basename(filePath, '.agent.md');
  }
  return path.basename(filePath, '.md');
}

function isDotAgentFile(filePath: string): boolean {
  return path.basename(filePath).toLowerCase().endsWith('.agent.md');
}

function isAgentMdFile(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === 'agent.md';
}

function isDotAgentYamlFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base.endsWith('.agent.yml') || base.endsWith('.agent.yaml');
}

function isAgentYamlFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base === 'agent.yml' || base === 'agent.yaml';
}

function isYamlAgentFile(filePath: string): boolean {
  return isDotAgentYamlFile(filePath) || isAgentYamlFile(filePath);
}

function isAiTeamAgentPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('/.ai-team/agents/');
}

function getMetadataSidecarCandidates(filePath: string): string[] {
  const lowerBase = path.basename(filePath).toLowerCase();
  if (lowerBase === 'agent.md') {
    return [
      path.join(path.dirname(filePath), 'agent.yml'),
      path.join(path.dirname(filePath), 'agent.yaml'),
    ];
  }

  if (lowerBase.endsWith('.agent.md')) {
    return [
      filePath.slice(0, -3) + '.yml',
      filePath.slice(0, -3) + '.yaml',
    ];
  }

  return [];
}

function getMarkdownSidecarCandidates(filePath: string): string[] {
  const lowerBase = path.basename(filePath).toLowerCase();
  if (lowerBase === 'agent.yml' || lowerBase === 'agent.yaml') {
    return [path.join(path.dirname(filePath), 'agent.md')];
  }

  if (lowerBase.endsWith('.agent.yml')) {
    return [filePath.slice(0, -4) + '.md'];
  }

  if (lowerBase.endsWith('.agent.yaml')) {
    return [filePath.slice(0, -5) + '.md'];
  }

  return [];
}

async function firstExistingPath(paths: string[]): Promise<string | undefined> {
  for (const candidate of paths) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function parseYamlSidecar(content: string, filePath: string): Record<string, unknown> {
  const wrapped = `---\n${content.trim()}\n---\n`;
  const { data } = matter(wrapped);

  if (content.trim().length > 0 && Object.keys(data).length === 0) {
    throw new ValidationError(`Invalid agent YAML metadata in ${filePath}`);
  }

  return data as Record<string, unknown>;
}

function stringifyYamlSidecar(data: Record<string, unknown>): string {
  const serialized = matter.stringify('', data).trim();
  const match = serialized.match(/^---\n([\s\S]*?)\n---$/);
  if (!match) {
    return serialized + '\n';
  }

  return match[1].trimEnd() + '\n';
}

async function readMarkdownAgentFile(filePath: string): Promise<{ data: Record<string, unknown>; markdown: string; }> {
  const content = await fs.readFile(filePath, 'utf-8');
  const { data, content: markdown } = matter(content);

  if (content.trimStart().startsWith('---') && Object.keys(data).length === 0) {
    throw new ValidationError(
      `Invalid agent configuration in ${filePath}: YAML frontmatter appears to be missing its closing --- delimiter.`
    );
  }

  return {
    data: data as Record<string, unknown>,
    markdown,
  };
}

function extractPortfolioFrontmatter(agent: Agent): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {};

  if (agent.name) frontmatter.name = agent.name;
  if (agent.description) frontmatter.description = agent.description;

  return frontmatter;
}

function extractMetadataFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const {
    description: _description,
    aiTeamName: _aiTeamName,
    aiTeamId: _aiTeamId,
    ...metadata
  } = frontmatter;
  return metadata;
}

function humanizeId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Load agent configuration from file
 * @param filePath - Absolute path to agent.md file
 * @returns Parsed agent data
 * @throws {FileNotFoundError} If file doesn't exist
 * @throws {ValidationError} If frontmatter is invalid
 */
export async function loadAgent(filePath: string): Promise<Agent> {
  try {
    const markdownPath = isYamlAgentFile(filePath)
      ? await firstExistingPath(getMarkdownSidecarCandidates(filePath))
      : filePath;

    const metadataPath = isYamlAgentFile(filePath)
      ? filePath
      : await firstExistingPath(getMetadataSidecarCandidates(filePath));

    const markdownRecord = markdownPath
      ? await readMarkdownAgentFile(markdownPath)
      : { data: {}, markdown: '' };

    const metadataRecord = metadataPath
      ? parseYamlSidecar(await fs.readFile(metadataPath, 'utf-8'), metadataPath)
      : {};

    // Validate against schema
    const config = AgentSchema.parse({
      ...markdownRecord.data,
      ...metadataRecord,
    }) as AgentConfig;
    
    const explicitId = normalizeText(config.id);
    const explicitName = normalizeText(config.name);
    const explicitAiTeamId = normalizeText(config.aiTeamId);
    const explicitAiTeamName = normalizeText(config.aiTeamName);

    const identityPath = markdownPath || metadataPath || filePath;
    const fallbackFileId = (isDotAgentFile(identityPath) || isAgentMdFile(identityPath))
      ? fileNameToAgentId(identityPath)
      : undefined;

    const hasExplicitIdentity = Boolean(
      explicitId || explicitName || explicitAiTeamId || explicitAiTeamName
    );

    if (!hasExplicitIdentity && !fallbackFileId) {
      throw new ValidationError(
        `Agent identity missing in ${identityPath}. Provide one of name, id, legacy aiTeamName, legacy aiTeamId, or use *.agent.md filename.`
      );
    }

    const effectiveId = explicitId
      || explicitAiTeamId
      || slugifyName(explicitName || explicitAiTeamName || fallbackFileId || '');

    if (!effectiveId) {
      throw new ValidationError(`Unable to resolve agent id for ${filePath}`);
    }

    const effectiveName = explicitName
      || explicitAiTeamName
      || humanizeId(effectiveId);
    
    // Find corresponding skill file
    const skillPath = path.join(path.dirname(identityPath), `${config.role}.md`);

    // Get file stats for timestamps
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
      // Ensure every agent has a deterministic colour even if not set in the file
      avatar: {
        ...config.avatar,
        type: config.avatar?.type ?? 'initials',
        color: config.avatar?.color ?? generateAgentColor({ name: effectiveName, avatar: config.avatar }),
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

/**
 * Save agent configuration to file
 * @param agent - Agent data to save
 * @throws {ValidationError} If agent data is invalid
 */
export async function saveAgent(agent: Agent): Promise<void> {
  // Validate before saving
  AgentSchema.parse(agent);
  
  // Separate frontmatter from file-specific and content fields
  const {
    filePath: _filePath,
    skillPath: _skillPath,
    createdAt: _createdAt,
    lastInteraction: _lastInteraction,
    conversationCount: _conversationCount,
    status: _status,
    markdown,
    ...frontmatter
  } = agent;
  
  // Strip undefined values — js-yaml cannot serialize them
  const cleanFrontmatter = Object.fromEntries(
    Object.entries(frontmatter).filter(([, v]) => v !== undefined)
  );

  const defaultMetadataPath = isAiTeamAgentPath(agent.filePath) && (isDotAgentFile(agent.filePath) || isAgentMdFile(agent.filePath))
    ? getMetadataSidecarCandidates(agent.filePath)[0]
    : undefined;
  const existingMetadataPath = await firstExistingPath(getMetadataSidecarCandidates(agent.filePath));
  const metadataPath = isYamlAgentFile(agent.filePath)
    ? agent.filePath
    : (existingMetadataPath || defaultMetadataPath);
  const markdownPath = isYamlAgentFile(agent.filePath)
    ? (getMarkdownSidecarCandidates(agent.filePath)[0] || agent.filePath)
    : agent.filePath;

  // Use markdown body if present, otherwise empty
  const body = (markdown || '').trim();

  if (metadataPath) {
    const portfolioFrontmatter = extractPortfolioFrontmatter(agent);
    const metadataFrontmatter = extractMetadataFrontmatter(cleanFrontmatter);
    const markdownContent = matter.stringify(body ? '\n' + body + '\n' : '', portfolioFrontmatter);
    const metadataContent = stringifyYamlSidecar(metadataFrontmatter);

    await fs.mkdir(path.dirname(markdownPath), { recursive: true });
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(markdownPath, markdownContent, 'utf-8');
    await fs.writeFile(metadataPath, metadataContent, 'utf-8');
    return;
  }

  const content = matter.stringify(body ? '\n' + body + '\n' : '', cleanFrontmatter);

  // Ensure directory exists
  await fs.mkdir(path.dirname(agent.filePath), { recursive: true });

  await fs.writeFile(agent.filePath, content, 'utf-8');
}

/**
 * Load skill template from file
 * @param filePath - Absolute path to skill.md file
 * @returns Parsed skill data
 * @throws {FileNotFoundError} If file doesn't exist
 * @throws {ValidationError} If frontmatter is invalid
 */
export async function loadSkill(filePath: string): Promise<Skill> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data, content: markdown } = matter(content);
    
    // Validate against schema
    const config = SkillSchema.parse(data) as SkillConfig;
    
    return {
      filePath,
      instructions: markdown.trim(),
      ...config,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileNotFoundError(filePath);
    }
    if (error instanceof Error && error.name === 'ZodError') {
      throw new ValidationError(`Invalid skill configuration in ${filePath}`, error);
    }
    throw error;
  }
}

/**
 * Save skill template to file
 * @param skill - Skill data to save
 * @throws {ValidationError} If skill data is invalid
 */
export async function saveSkill(skill: Skill): Promise<void> {
  // Validate before saving
  SkillSchema.parse(skill);
  
  const { filePath: _filePath, instructions, ...frontmatter } = skill;
  
  const content = matter.stringify(instructions, frontmatter);
  
  // Ensure directory exists
  await fs.mkdir(path.dirname(skill.filePath), { recursive: true });
  
  await fs.writeFile(skill.filePath, content, 'utf-8');
}

/**
 * Find all agent files in workspace
 * @param workspaceRoot - Root directory to search
 * @returns Array of absolute file paths
 */
export async function findAgentFiles(workspaceRoot: string): Promise<string[]> {
  const patterns = [
    '**/agent.md',
    '**/*.agent.md',
    '.ai-team/agents/*.md',
    '.github/agents/*.md',
  ];

  const ignore = ['**/node_modules/**', '**/.git/**'];
  const allResults = await Promise.all(
    patterns.map(pattern => glob(pattern, {
      cwd: workspaceRoot,
      absolute: true,
      ignore,
    }))
  );

  return Array.from(new Set(allResults.flat())).sort((a, b) => a.localeCompare(b));
}

/**
 * Find all skill files in workspace
 * @param workspaceRoot - Root directory to search
 * @returns Array of absolute file paths
 */
export async function findSkillFiles(workspaceRoot: string): Promise<string[]> {
  const pattern = '.ai-team/roles/*.md';
  const files = await glob(pattern, {
    cwd: workspaceRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
  });
  return files;
}

/**
 * Check if a file exists
 * @param filePath - Path to check
 * @returns True if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure .ai-team directory structure exists
 * @param workspaceRoot - Workspace root directory
 */
export async function ensureAiTeamDirectory(workspaceRoot: string): Promise<void> {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  
  // Create directories
  await fs.mkdir(path.join(aiTeamDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'instructions'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'prompts'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'hooks'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'skills'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'roles'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'features'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'meetings'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'private', 'chats'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'avatars'), { recursive: true });
  await fs.mkdir(path.join(aiTeamDir, 'skills-catalog'), { recursive: true });
}

// ============================================================================
// Team Configuration (config.json)
// ============================================================================

/**
 * Get the config.json path for a workspace
 * @param workspaceRoot - Workspace root directory
 * @returns Absolute path to config.json
 */
export function getConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.ai-team', 'config.json');
}

/**
 * Load team configuration from .ai-team/config.json
 * @param workspaceRoot - Workspace root directory
 * @returns Parsed team config, or undefined if not found
 */
export async function loadTeamConfig(workspaceRoot: string): Promise<TeamConfig | undefined> {
  const configPath = getConfigPath(workspaceRoot);
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const data = JSON.parse(content);
    return TeamConfigSchema.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Save team configuration to .ai-team/config.json
 * @param workspaceRoot - Workspace root directory
 * @param config - Team configuration to save
 */
export async function saveTeamConfig(workspaceRoot: string, config: TeamConfig): Promise<void> {
  const configPath = getConfigPath(workspaceRoot);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ============================================================================
// Environment file (.env) for secrets
// ============================================================================

/**
 * Get the .env file path for a workspace
 * @param workspaceRoot - Workspace root directory
 * @returns Absolute path to .env
 */
export function getEnvPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.ai-team', '.env');
}

/**
 * Load environment variables from .ai-team/.env
 * @param workspaceRoot - Workspace root directory
 * @returns Key-value map of env vars, or empty object if file missing
 */
export async function loadEnvFile(workspaceRoot: string): Promise<Record<string, string>> {
  const envPath = getEnvPath(workspaceRoot);
  try {
    const content = await fs.readFile(envPath, 'utf-8');
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * Save environment variables to .ai-team/.env
 * @param workspaceRoot - Workspace root directory
 * @param vars - Key-value map of env vars to write
 */
export async function saveEnvFile(workspaceRoot: string, vars: Record<string, string>): Promise<void> {
  const envPath = getEnvPath(workspaceRoot);
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  const lines = ['# AI Team secrets — DO NOT commit this file', ''];
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key}="${value}"`);
  }
  lines.push('');
  await fs.writeFile(envPath, lines.join('\n'), 'utf-8');
}

// ============================================================================
// Markdown Section Utilities
// ============================================================================

/**
 * A parsed markdown section with its heading and body content
 */
export interface MarkdownSection {
  /** Heading text (empty string for preamble before first ## heading) */
  heading: string;
  /** Body content (without the heading line itself), trimmed */
  content: string;
}

/**
 * Input for building agent markdown from structured parts
 */
export interface AgentMarkdownParts {
  /** Avatar image markdown, e.g. `![avatar](../avatars/id.jpg)` */
  avatar?: string;
  /** Introduction paragraph (placed under ## Introduction) */
  introduction?: string;
  /** Personality profile bullet lines (each line without the leading `- `) */
  personalityProfile?: string[];
  /** Skills with heading name and body content */
  skills?: Array<{ name: string; body: string }>;
  /** Additional sections in order */
  extraSections?: Array<{ heading: string; content: string }>;
}

/**
 * Parse a markdown body into ordered sections split on `## ` boundaries.
 * Content before the first `## ` heading is returned with heading = "".
 *
 * @param markdown - The raw markdown body (without YAML frontmatter)
 * @returns Ordered array of sections
 */
export function parseMarkdownSections(markdown: string): MarkdownSection[] {
  if (!markdown || !markdown.trim()) return [];

  const lines = markdown.split('\n');
  const sections: MarkdownSection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    // Match ## headings (but not ### or deeper)
    const match = line.match(/^## (.+)$/);
    if (match) {
      // Flush previous section
      sections.push({
        heading: currentHeading,
        content: currentLines.join('\n').trim(),
      });
      currentHeading = match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush last section
  sections.push({
    heading: currentHeading,
    content: currentLines.join('\n').trim(),
  });

  // Remove leading empty preamble if it's blank
  if (sections.length > 0 && sections[0].heading === '' && sections[0].content === '') {
    sections.shift();
  }

  return sections;
}

/**
 * Replace a markdown section by heading title, or append it at the end if not found.
 *
 * @param markdown - The raw markdown body
 * @param heading - The heading title to find/replace (without the `## ` prefix)
 * @param newContent - The new body content for that section
 * @returns Updated markdown string
 */
export function replaceOrAppendMarkdownSection(
  markdown: string,
  heading: string,
  newContent: string,
): string {
  const sections = parseMarkdownSections(markdown || '');
  const index = sections.findIndex(s => s.heading === heading);

  if (index >= 0) {
    sections[index] = { heading, content: newContent.trim() };
  } else {
    sections.push({ heading, content: newContent.trim() });
  }

  return sectionsToMarkdown(sections);
}

/**
 * Serialize an ordered array of sections back to markdown text.
 */
function sectionsToMarkdown(sections: MarkdownSection[]): string {
  const parts: string[] = [];

  for (const section of sections) {
    if (section.heading === '') {
      // Preamble (avatar, etc.)
      if (section.content) {
        parts.push(section.content);
      }
    } else {
      parts.push(`## ${section.heading}\n${section.content}`);
    }
  }

  return parts.join('\n\n') + '\n';
}

/**
 * Build a complete agent markdown body from structured parts.
 * This is the canonical layout used by hire/init commands when generating markdown.
 * Callers may also provide raw markdown directly via `updateAgent({ markdown })`.
 *
 * @param parts - Structured markdown parts
 * @returns Assembled markdown string
 */
export function buildAgentMarkdown(parts: AgentMarkdownParts): string {
  const sections: MarkdownSection[] = [];

  // Avatar goes in the preamble (before any ## heading)
  if (parts.avatar) {
    sections.push({ heading: '', content: parts.avatar });
  }

  // Introduction section
  if (parts.introduction) {
    sections.push({ heading: 'Introduction', content: parts.introduction });
  }

  // Personality Profile section
  if (parts.personalityProfile && parts.personalityProfile.length > 0) {
    const bullets = parts.personalityProfile.map(line => `- ${line}`).join('\n');
    sections.push({ heading: 'Personality Profile', content: bullets });
  }

  // Skills section with sub-headings
  if (parts.skills && parts.skills.length > 0) {
    const skillParts = parts.skills
      .map(s => `### ${s.name}\n\n${s.body}`)
      .join('\n\n');
    sections.push({ heading: 'Skills', content: skillParts });
  }

  // Extra sections in order
  if (parts.extraSections) {
    for (const extra of parts.extraSections) {
      sections.push({ heading: extra.heading, content: extra.content.trim() });
    }
  }

  return sectionsToMarkdown(sections);
}

// File tree utilities — re-export for convenience
export * from './file-tree.js';
export * from './file-tree-cache.js';

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

/**
 * Load agent configuration from file
 * @param filePath - Absolute path to agent.md file
 * @returns Parsed agent data
 * @throws {FileNotFoundError} If file doesn't exist
 * @throws {ValidationError} If frontmatter is invalid
 */
export async function loadAgent(filePath: string): Promise<Agent> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data, content: markdown } = matter(content);
    
    // Validate against schema
    const config = AgentSchema.parse(data) as AgentConfig;
    
    // Generate ID from filename (remove .md extension)
    const id = path.basename(filePath, '.md');
    
    // Find corresponding skill file
    const skillPath = path.join(path.dirname(filePath), `${config.role}.md`);
    
    // Get file stats for timestamps
    const stats = await fs.stat(filePath);
    
    return {
      id,
      filePath,
      skillPath,
      markdown,
      createdAt: stats.birthtime.toISOString(),
      lastInteraction: stats.mtime.toISOString(),
      ...config,
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
  const config = AgentSchema.parse(agent);
  
  // Separate frontmatter from file-specific and content fields
  const { filePath, id, skillPath, createdAt, lastInteraction, conversationCount, status, markdown, ...frontmatter } = agent;
  
  // Strip undefined values — js-yaml cannot serialize them
  const cleanFrontmatter = Object.fromEntries(
    Object.entries(frontmatter).filter(([, v]) => v !== undefined)
  );

  // Use markdown body if present, otherwise empty
  const body = (markdown || '').trim();
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
  
  const { filePath, instructions, ...frontmatter } = skill;
  
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
  const pattern = '.ai-team/agents/*.md';
  const files = await glob(pattern, {
    cwd: workspaceRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
  });
  return files;
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

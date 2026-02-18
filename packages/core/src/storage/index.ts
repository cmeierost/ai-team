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
  
  // Separate frontmatter from file-specific fields
  const { filePath, id, skillPath, createdAt, lastInteraction, conversationCount, status, ...frontmatter } = agent;
  
  const content = matter.stringify('', frontmatter);
  
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
}

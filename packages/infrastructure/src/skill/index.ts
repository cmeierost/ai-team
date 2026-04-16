/**
 * Skill manager - handles loading and managing skill templates
 */

import path from 'node:path';
import type { Agent, AgentSkillFile, Skill, SkillConfig } from '@ai-team/core';
import {
  loadSkill,
  loadAgentSkillFile,
  resolveAgentSkillFilePath,
  saveSkill,
  findSkillFiles,
} from '../agent/storage.js';

export interface ResolvedAgentSkills {
  roleSkill?: Skill;
  specializationSkills: Skill[];
  skills: Skill[];
  missingSkillNames: string[];
}

export interface SessionSkillRecord {
  skillPath: string;
  paused: boolean;
}

export interface ResolvedSessionSkillsResult {
  /** Skills that were newly matched and must be persisted to the DB. */
  newlyLoaded: AgentSkillFile[];
  /** All active (non-paused) session skill files ready to inject into the prompt. */
  activeSkills: AgentSkillFile[];
}

export class SkillManager {
  private skills: Map<string, Skill> | undefined;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get the skills map, loading from disk on first call.
   */
  async getSkills(): Promise<Map<string, Skill>> {
    this.skills ??= await this.loadAllSkills();
    return this.skills;
  }

  /**
   * Force a full refresh from disk.
   */
  async refresh(): Promise<void> {
    this.skills = undefined;
    await this.getSkills();
  }

  /**
   * Load all skill templates from workspace
   */
  private async loadAllSkills(): Promise<Map<string, Skill>> {
    const skillFiles = await findSkillFiles(this.workspaceRoot);
    const skills = new Map<string, Skill>();

    for (const filePath of skillFiles) {
      try {
        const skill = await loadSkill(filePath);
        skills.set(skill.name, skill);
      } catch (error) {
        console.error(`Failed to load skill from ${filePath}:`, error);
      }
    }
    return skills;
  }

  /**
   * Get all loaded skills
   */
  async getAllSkills(): Promise<Skill[]> {
    return Array.from((await this.getSkills()).values());
  }

  /**
   * Get skill by name
   */
  async getSkill(name: string): Promise<Skill | undefined> {
    return (await this.getSkills()).get(name);
  }

  /**
   * Resolve all skills that should be applied for an agent turn.
   * Includes the role skill and any specialization skills (if present).
   */
  async resolveSkillsForAgent(
    agent: Pick<Agent, 'role' | 'specializations'>
  ): Promise<ResolvedAgentSkills> {
    const roleSkill = await this.getSkill(agent.role);
    const specializationSkills: Skill[] = [];
    const missingSkillNames: string[] = [];

    for (const skillName of agent.specializations ?? []) {
      const skill = await this.getSkill(skillName);
      if (skill) {
        specializationSkills.push(skill);
      } else {
        missingSkillNames.push(skillName);
      }
    }

    return {
      roleSkill,
      specializationSkills,
      skills: [...(roleSkill ? [roleSkill] : []), ...specializationSkills],
      missingSkillNames,
    };
  }

  /**
   * Create a new skill template
   * @param config - Skill configuration
   * @param instructions - Markdown instructions for this role
   * @returns Created skill
   */
  async createSkillAsync(config: SkillConfig, instructions: string): Promise<Skill> {
    const skills = await this.getSkills();
    const filePath = path.join(this.workspaceRoot, '.ai-team', 'roles', `${config.name}.md`);

    const skill: Skill = {
      filePath,
      instructions,
      ...config,
    };

    await saveSkill(skill);
    skills.set(config.name, skill);

    return skill;
  }

  /**
   * Update an existing skill
   * @param name - Skill name
   * @param updates - Partial skill config to update
   * @param instructions - Optional updated instructions
   * @returns Updated skill
   */
  async updateSkill(
    name: string,
    updates: Partial<SkillConfig>,
    instructions?: string
  ): Promise<Skill> {
    const skills = await this.getSkills();
    const skill = skills.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    const updatedSkill: Skill = {
      ...skill,
      ...updates,
      instructions: instructions || skill.instructions,
    };

    await saveSkill(updatedSkill);
    skills.set(name, updatedSkill);

    return updatedSkill;
  }

  /**
   * Test whether any of the trigger patterns match the given message.
   * Each trigger is treated as a case-insensitive regex string.
   * Returns true on the first match.
   */
  matchTriggersForMessage(triggers: string[], message: string): boolean {
    for (const trigger of triggers) {
      try {
        if (new RegExp(trigger, 'i').test(message)) {
          return true;
        }
      } catch {
        // Treat invalid regex as literal string
        if (message.toLowerCase().includes(trigger.toLowerCase())) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Resolve which .ai-team/skills/<id>/SKILL.md files to inject this turn.
   *
   * - Already loaded + non-paused skills are always included.
   * - Skills not yet loaded are checked against their triggers vs the user message.
   *   Matches are returned as `newlyLoaded` so the caller can persist them.
   * - Paused skills are excluded regardless of trigger matches.
   */
  async resolveSessionSkills(
    allowedSkillIds: string[],
    loadedRecords: SessionSkillRecord[],
    userMessage: string
  ): Promise<ResolvedSessionSkillsResult> {
    const loadedPaths = new Set(loadedRecords.map((r) => r.skillPath));
    const pausedPaths = new Set(loadedRecords.filter((r) => r.paused).map((r) => r.skillPath));

    const newlyLoaded: AgentSkillFile[] = [];
    const activeByPath = new Map<string, AgentSkillFile>();

    // Load already-active skills first (non-paused, already in session)
    for (const record of loadedRecords) {
      if (record.paused) continue;
      try {
        const absPath = path.join(this.workspaceRoot, record.skillPath);
        const skill = await loadAgentSkillFile(absPath);
        activeByPath.set(record.skillPath, skill);
      } catch {
        // File was deleted or moved — skip silently
      }
    }

    // Check each allowed skill not yet in the session
    for (const skillId of allowedSkillIds) {
      const absPath = resolveAgentSkillFilePath(this.workspaceRoot, skillId);
      const relPath = path.relative(this.workspaceRoot, absPath).replaceAll('\\', '/');
      if (loadedPaths.has(relPath) || pausedPaths.has(relPath)) continue;

      let skillFile: AgentSkillFile;
      try {
        skillFile = await loadAgentSkillFile(absPath);
      } catch {
        continue; // SKILL.md does not exist for this id
      }

      if (!skillFile.triggers || skillFile.triggers.length === 0) continue;
      if (!this.matchTriggersForMessage(skillFile.triggers, userMessage)) continue;

      newlyLoaded.push(skillFile);
      activeByPath.set(relPath, skillFile);
    }

    return { newlyLoaded, activeSkills: Array.from(activeByPath.values()) };
  }
}

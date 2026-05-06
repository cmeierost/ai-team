/**
 * Skill manager - handles loading and managing skill templates
 */

import path from 'node:path';
import type {
  Agent,
  AgentSkillFile,
  IAgentDocumentStorage,
  IWorkspaceDiscoveryStorage,
  ResolvedAgentSkills,
  ResolvedSessionSkillsResult,
  SessionSkillRecord,
  Skill,
  SkillConfig,
} from '@ai-team/core';
import { AgentDocumentStorage } from '../agent/agent-document-storage.js';
import { MarkdownSectionService } from '../agent/markdown-service.js';
import { WorkspaceDiscoveryStorage } from '../agent/workspace-discovery-storage.js';
import { WorkspaceStorage } from '../agent/workspace-storage.js';

export class SkillManager {
  private skills: Map<string, Skill> | undefined;
  private readonly workspaceRoot: string;

  constructor(
    workspaceRoot: string,
    private readonly agentDocumentStorage: IAgentDocumentStorage,
    private readonly workspaceDiscoveryStorage: IWorkspaceDiscoveryStorage
  ) {
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
    const skillFiles = await this.workspaceDiscoveryStorage.findSkillFilesAsync(this.workspaceRoot);
    const skills = new Map<string, Skill>();

    for (const filePath of skillFiles) {
      try {
        const skill = await this.agentDocumentStorage.loadSkillAsync(filePath);
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

    await this.agentDocumentStorage.saveSkillAsync(skill);
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

    await this.agentDocumentStorage.saveSkillAsync(updatedSkill);
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
        const skill = await this.agentDocumentStorage.loadAgentSkillFileAsync(absPath);
        activeByPath.set(record.skillPath, skill);
      } catch {
        // File was deleted or moved — skip silently
      }
    }

    // Check each allowed skill not yet in the session
    for (const skillId of allowedSkillIds) {
      const absPath = this.workspaceDiscoveryStorage.resolveAgentSkillFilePath(
        this.workspaceRoot,
        skillId
      );
      const relPath = path.relative(this.workspaceRoot, absPath).replaceAll('\\', '/');
      if (loadedPaths.has(relPath) || pausedPaths.has(relPath)) continue;

      let skillFile: AgentSkillFile;
      try {
        skillFile = await this.agentDocumentStorage.loadAgentSkillFileAsync(absPath);
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

export function createSkillManager(workspaceRoot: string): SkillManager {
  const markdownSectionService = new MarkdownSectionService();
  const workspaceStorage = new WorkspaceStorage();
  const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();
  const agentDocumentStorage = new AgentDocumentStorage(
    markdownSectionService,
    workspaceStorage,
    workspaceDiscoveryStorage
  );

  return new SkillManager(workspaceRoot, agentDocumentStorage, workspaceDiscoveryStorage);
}

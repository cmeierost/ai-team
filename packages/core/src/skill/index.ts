/**
 * Skill manager - handles loading and managing skill templates
 */

import type { Agent, AgentSkillFile, Skill, SkillConfig } from '../types/index.js';

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

export interface ISkillManager {
  refresh(): Promise<void>;
  getAllSkills(): Promise<Skill[]>;
  getSkill(name: string): Promise<Skill | undefined>;
  resolveSkillsForAgent(
    agent: Pick<Agent, 'role' | 'specializations'>
  ): Promise<ResolvedAgentSkills>;
  createSkillAsync(config: SkillConfig, instructions: string): Promise<Skill>;
  updateSkill(name: string, updates: Partial<SkillConfig>, instructions?: string): Promise<Skill>;
  matchTriggersForMessage(triggers: string[], message: string): boolean;
  resolveSessionSkills(
    allowedSkillIds: string[],
    loadedRecords: SessionSkillRecord[],
    userMessage: string
  ): Promise<ResolvedSessionSkillsResult>;
}

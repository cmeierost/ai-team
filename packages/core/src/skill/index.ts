/**
 * Skill manager - handles loading and managing skill templates
 */

import path from 'path';
import { Skill, SkillConfig } from '../types/index.js';
import {
  loadSkill,
  saveSkill,
  findSkillFiles,
} from '../storage/index.js';

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Initialize skill manager by loading all skill templates
   */
  async initialize(): Promise<void> {
    await this.loadAllSkills();
  }

  /**
   * Load all skill templates from workspace
   */
  async loadAllSkills(): Promise<void> {
    const skillFiles = await findSkillFiles(this.workspaceRoot);
    
    this.skills.clear();
    
    for (const filePath of skillFiles) {
      try {
        const skill = await loadSkill(filePath);
        this.skills.set(skill.name, skill);
        console.log(`Loaded skill: ${skill.name} (${filePath})`);
      } catch (error) {
        console.error(`Failed to load skill from ${filePath}:`, error);
      }
    }
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill by name
   * @param name - Skill name
   * @returns Skill or undefined
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Create a new skill template
   * @param config - Skill configuration
   * @param instructions - Markdown instructions for this role
   * @returns Created skill
   */
  async createSkill(config: SkillConfig, instructions: string): Promise<Skill> {
    const filePath = path.join(
      this.workspaceRoot,
      '.ai-team',
      'roles',
      `${config.name}.md`
    );

    const skill: Skill = {
      filePath,
      instructions,
      ...config,
    };

    await saveSkill(skill);
    this.skills.set(config.name, skill);

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
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    const updatedSkill: Skill = {
      ...skill,
      ...updates,
      instructions: instructions || skill.instructions,
    };

    await saveSkill(updatedSkill);
    this.skills.set(name, updatedSkill);

    return updatedSkill;
  }
}

import fs from 'fs/promises';
import path from 'path';
import {
  AgentManager,
  ContextLevel,
  RoleType,
} from '@ai-team/core';
import type { HireOptions } from '../contracts.js';

interface SkillCatalogEntry {
  name: string;
  description: string;
  filePath: string;
}

function getPersonalityForHire(role: string, roleType: RoleType) {
  const r = role.toLowerCase();

  if (/architect|cto/.test(r) || roleType === RoleType.EXECUTIVE) {
    return {
      communication_style: 'strategic' as const,
      expertise_level: 'executive' as const,
      mentoring: true,
      profile: [
        'Highly intelligent and systems-focused',
        'Determined, strategic, and structured',
        'Communicates decisions clearly and confidently',
      ],
    };
  }

  if (/hr|people|recruit|headhunt/.test(r)) {
    return {
      communication_style: 'supportive' as const,
      expertise_level: roleType === RoleType.LEADERSHIP ? 'senior' as const : 'mid-level' as const,
      mentoring: true,
      profile: [
        'Friendly, chatty, and people-oriented',
        'Strong at understanding motivation and fit',
        'Keeps momentum while staying empathetic',
      ],
    };
  }

  if (/qa|test|security|data|analyst/.test(r)) {
    return {
      communication_style: 'analytical' as const,
      expertise_level: roleType === RoleType.TEAM_LEAD ? 'senior' as const : 'mid-level' as const,
      mentoring: true,
      profile: [
        'Analytical and detail-oriented',
        'Thinks in trade-offs, risks, and evidence',
        'High standards, clear rationale',
      ],
    };
  }

  return {
    communication_style: 'collaborative' as const,
    expertise_level: roleType === RoleType.TEAM_LEAD ? 'senior' as const : 'mid-level' as const,
    mentoring: true,
    profile: [
      'Motivated, practical, and reliable',
      'Works well with others and communicates clearly',
      'Balances speed with quality',
    ],
  };
}

export async function hireCommand(workspaceRoot: string, options: HireOptions) {
  try {
    const agentManager = new AgentManager(workspaceRoot);
    await agentManager.initialize();

    if (!options.name || !options.role) {
      throw new Error('Hire requires --name and --role when service-side prompts are disabled.');
    }

    const config: {
      name: string;
      role: string;
      selectedSkills: string[];
      roleType: RoleType;
      contextLevel: ContextLevel;
      reportsTo?: string;
      features?: string[];
      specializations?: string[];
      pronouns?: string;
      timezone?: string;
      llm?: undefined;
      cliTools?: string[];
    } = {
      name: options.name,
      role: options.role,
      selectedSkills: options.skill ? [options.skill] : [],
      roleType: (options.type as RoleType) || RoleType.INDIVIDUAL_CONTRIBUTOR,
      contextLevel: ContextLevel.MODULE,
      reportsTo: options.reportsTo,
      llm: undefined,
      cliTools: undefined,
    };

    const personalityPreset = getPersonalityForHire(config.role, config.roleType);

    const portfolioSections: string[] = [];
    portfolioSections.push(`# ${config.name} — ${config.role}\n`);
    portfolioSections.push('## Personality Profile\n');
    for (const line of personalityPreset.profile) {
      portfolioSections.push(`- ${line}`);
    }
    portfolioSections.push('');

    if (config.selectedSkills.length > 0) {
      portfolioSections.push('## Skills\n');
      for (const skillName of config.selectedSkills) {
        const content = await readSkillContent(workspaceRoot, skillName);
        if (content) {
          const body = content.replace(/^---[\s\S]*?---\s*/, '').trim();
          portfolioSections.push(`### ${skillName}\n\n${body}\n`);
        } else {
          portfolioSections.push(`### ${skillName}\n`);
        }
      }
    }

    const markdown = portfolioSections.join('\n');

    try {
      const agent = await agentManager.createAgent(
        {
          name: config.name,
          role: config.role,
          type: config.roleType,
          contextLevel: config.contextLevel,
          reportsTo: config.reportsTo,
          features: config.features,
          specializations: config.specializations,
          pronouns: config.pronouns,
          timezone: config.timezone,
          personality: {
            communication_style: personalityPreset.communication_style,
            expertise_level: personalityPreset.expertise_level,
            mentoring: personalityPreset.mentoring,
          },
          // Note: Avatar is not set during hire - use `ait avatar <agent>` command
          llm: config.llm,
          cliTools: config.cliTools,
        },
        undefined
      );

      await appendMarkdownToAgent(agent.filePath, markdown);

      if (config.reportsTo) {
        const manager = agentManager.getAgent(config.reportsTo);
        void manager;
      }
    } catch (error) {
      throw error;
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `Error during hire: ${String(error)}`);
  }
}


async function appendMarkdownToAgent(filePath: string, markdown: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const updated = content.trimEnd() + '\n' + markdown;
  await fs.writeFile(filePath, updated, 'utf-8');
}


async function readSkillContent(workspaceRoot: string, skillName: string): Promise<string | null> {
  const skillMdPath = path.join(workspaceRoot, '.ai-team', 'skills-catalog', skillName, 'SKILL.md');
  try {
    return await fs.readFile(skillMdPath, 'utf-8');
  } catch {
    return null;
  }
}


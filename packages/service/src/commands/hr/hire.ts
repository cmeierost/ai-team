import fs from 'fs/promises';
import path from 'path';
import { ContextLevel, RoleType } from '@ai-team/core';
import type { IAgentManager, IMarkdownSectionService } from '@ai-team/core';
import type { HireOptions, InteractionContext } from '@ai-team/api-contracts';

export function getPersonalityForHire(role: string, roleType: RoleType) {
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
      expertise_level:
        roleType === RoleType.LEADERSHIP ? ('senior' as const) : ('mid-level' as const),
      mentoring: true,
      profile: [
        'Friendly and people-oriented',
        'Strong at understanding motivation and fit',
        'Keeps momentum while staying empathetic',
      ],
    };
  }

  if (/qa|test|security|data|analyst/.test(r)) {
    return {
      communication_style: 'analytical' as const,
      expertise_level:
        roleType === RoleType.TEAM_LEAD ? ('senior' as const) : ('mid-level' as const),
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
    expertise_level: roleType === RoleType.TEAM_LEAD ? ('senior' as const) : ('mid-level' as const),
    mentoring: true,
    profile: [
      'Motivated, practical, and reliable',
      'Works well with others and communicates clearly',
      'Balances speed with quality',
    ],
  };
}

export class HireCommand {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly markdownSectionService: IMarkdownSectionService
  ) {}

  async execute(options: HireOptions, context: InteractionContext = {}): Promise<void> {
    return hireCommandImpl(this.agentManager, this.markdownSectionService, options, context);
  }
}

async function hireCommandImpl(
  agentManager: IAgentManager,
  markdownSectionService: IMarkdownSectionService,
  options: HireOptions,
  context: InteractionContext = {}
) {
  try {
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

    // Build structured markdown using the canonical layout
    const skillEntries: Array<{ name: string; body: string }> = [];
    if (config.selectedSkills.length > 0) {
      for (const skillName of config.selectedSkills) {
        const content = await readSkillContent(agentManager.workspaceRoot, skillName);
        const body = content ? content.replace(/^---[\s\S]*?---\s*/, '').trim() : '';
        skillEntries.push({ name: skillName, body });
      }
    }

    const markdown = markdownSectionService.buildAgentMarkdown({
      personalityProfile: personalityPreset.profile,
      skills: skillEntries.length > 0 ? skillEntries : undefined,
    });

    try {
      await agentManager.createAgentAsync(
        {
          name: config.name,
          role: config.role,
          type: config.roleType,
          contextLevel: config.contextLevel,
          reportsTo: config.reportsTo,
          features: config.features,
          specializations: config.specializations,
          pronouns: config.pronouns,
          personality: {
            communication_style: personalityPreset.communication_style,
            expertise_level: personalityPreset.expertise_level,
            mentoring: personalityPreset.mentoring,
          },
          llm: config.llm,
          cliTools: config.cliTools,
        },
        { markdown }
      );

      context.emit?.({
        kind: 'log',
        level: 'info',
        message: `✓ ${config.name} has been hired as ${config.role}.`,
      });

      if (config.reportsTo) {
        await agentManager.getAgentAsync(config.reportsTo);
      }
    } catch (error) {
      throw error;
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `Error during hire: ${String(error)}`);
  }
}

async function readSkillContent(workspaceRoot: string, skillName: string): Promise<string | null> {
  const skillMdPath = path.join(workspaceRoot, '.ai-team', 'skills-catalog', skillName, 'SKILL.md');
  try {
    return await fs.readFile(skillMdPath, 'utf-8');
  } catch {
    return null;
  }
}

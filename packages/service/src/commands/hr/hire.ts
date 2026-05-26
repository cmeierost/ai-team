import fs from 'node:fs/promises';
import path from 'node:path';
import { ContextLevel, RoleType } from '@ai-team/core';
import type { IAgentManager, IMarkdownSectionService, ExecutionContext } from '@ai-team/core';
import type { HireOptions } from '@ai-team/api-contracts';

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
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly markdownSectionService: IMarkdownSectionService
  ) {}

  async execute(options: HireOptions, ctx: ExecutionContext): Promise<void> {
    return hireCommandImpl(
      this.workspaceRoot,
      this.agentManager,
      this.markdownSectionService,
      options,
      ctx
    );
  }
}

async function hireCommandImpl(
  workspaceRoot: string,
  agentManager: IAgentManager,
  markdownSectionService: IMarkdownSectionService,
  options: HireOptions,
  ctx: ExecutionContext
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
      cliTools?: string[];
    } = {
      name: options.name,
      role: options.role,
      selectedSkills: options.skill ? [options.skill] : [],
      roleType: (options.type as RoleType) || RoleType.INDIVIDUAL_CONTRIBUTOR,
      contextLevel: ContextLevel.MODULE,
      reportsTo: options.reportsTo,
      cliTools: undefined,
    };

    const personalityPreset = getPersonalityForHire(config.role, config.roleType);

    const skillEntries: Array<{ name: string; body: string }> = [];
    if (config.selectedSkills.length > 0) {
      for (const skillName of config.selectedSkills) {
        const content = await readSkillContent(workspaceRoot, skillName);
        const body = content ? content.replace(/^---[\s\S]*?---\s*/, '').trim() : '';
        skillEntries.push({ name: skillName, body });
      }
    }

    const markdown = markdownSectionService.buildAgentMarkdown({
      personalityProfile: personalityPreset.profile,
      skills: skillEntries.length > 0 ? skillEntries : undefined,
    });
    await agentManager.createAgentAsync(
      {
        name: config.name,
        role: config.role,
        type: config.roleType,
        contextLevel: config.contextLevel,
        reportsTo: config.reportsTo,
        personality: {
          communication_style: personalityPreset.communication_style,
          expertise_level: personalityPreset.expertise_level,
          mentoring: personalityPreset.mentoring,
        },
        introduction: markdown,
        specializations: config.specializations,
        features: config.features,
        pronouns: config.pronouns,
        cliTools: config.cliTools,
      },
      { markdown }
    );

    ctx.emit?.({
      kind: 'log',
      level: 'info',
      message: `✓ ${config.name} has been hired as ${config.role}.`,
    });

    if (config.reportsTo) {
      await agentManager.getAgentAsync(config.reportsTo);
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

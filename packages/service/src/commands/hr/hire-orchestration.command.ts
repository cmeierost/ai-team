import { z } from 'zod';
import {
  ContextLevel,
  RoleType,
  type ExecutionContext,
  type HireResult,
  type ICommand,
  type CommandResponse,
  ICommandDescriptor,
  type IMarkdownSectionService,
  type PersonalityConfig,
} from '@ai-team/core';
import type { IAgentRegistry } from '../orchestration/orchestration.types.js';

type Params = z.infer<typeof HireOrchestrationCommand.schema>;
const _hireOrchestrationCommandSchema = z.object({
  name: z.string().min(1).describe('Full name of the new team member'),
  role: z.string().min(1).describe('Job role / title'),
  type: z
    .enum(['executive', 'team-lead', 'individual-contributor'])
    .optional()
    .describe('Role type. Defaults to inferred from the role name.'),
  contextLevel: z
    .enum(['organization', 'repository', 'feature', 'module', 'task'])
    .optional()
    .describe('Context level. Defaults to organization for executives, module otherwise.'),
  specializations: z.array(z.string()).optional().describe('Areas of expertise'),
  reportsTo: z.string().optional().describe('Agent ID of the direct manager'),
  personality: z
    .looseObject({
      communication_style: z.string().optional(),
      expertise_level: z.string().optional(),
      mentoring: z.boolean().optional(),
    })
    .optional()
    .describe('Personality configuration (communication style, expertise level, mentoring).'),
  introduction: z
    .string()
    .optional()
    .describe('Optional rich introduction markdown for the agent profile.'),
  personalityProfile: z
    .array(z.string())
    .optional()
    .describe('Optional personality-profile bullet list rendered into the agent markdown.'),
});

export const HireOrchestrationCommandMetadata = {
  key: 'hire',
  description:
    'Create a new virtual team member with a defined role, optional personality/type/context-level, and optional rich introduction & personality profile markdown. Requires manage_agents permission.',
  availableIn: { tool: true },
  group: 'hr',
  parameters: _hireOrchestrationCommandSchema,
  permissionCheck: { type: 'manage-agents' as const },
  tags: ['orchestration', 'hr'],
} satisfies ICommandDescriptor;

const ROLE_TYPE_MAP: Record<string, RoleType> = {
  executive: RoleType.EXECUTIVE,
  'team-lead': RoleType.TEAM_LEAD,
  'individual-contributor': RoleType.INDIVIDUAL_CONTRIBUTOR,
};

const CONTEXT_LEVEL_MAP: Record<string, ContextLevel> = {
  organization: ContextLevel.ORGANIZATION,
  repository: ContextLevel.REPOSITORY,
  feature: ContextLevel.FEATURE,
  module: ContextLevel.MODULE,
  task: ContextLevel.TASK,
};

function inferRoleType(role: string): RoleType {
  const r = role.toLowerCase();
  if (/ceo|cto|cfo|coo|chief|vp|director/.test(r)) return RoleType.EXECUTIVE;
  if (/lead|head|manager|principal/.test(r)) return RoleType.TEAM_LEAD;
  return RoleType.INDIVIDUAL_CONTRIBUTOR;
}

export class HireOrchestrationCommand implements ICommand<Params, HireResult> {
  static readonly schema = _hireOrchestrationCommandSchema;
  readonly metadata = HireOrchestrationCommandMetadata;

  constructor(
    private readonly agents: IAgentRegistry,
    private readonly markdownSectionService?: IMarkdownSectionService
  ) {}

  async execute(params: Params, ctx: ExecutionContext): Promise<CommandResponse<HireResult>> {
    const {
      name,
      role,
      specializations = [],
      reportsTo,
      type,
      contextLevel,
      personality,
      introduction,
      personalityProfile,
    } = params;

    const resolvedType = type ? ROLE_TYPE_MAP[type] : inferRoleType(role);
    let resolvedContextLevel: ContextLevel;
    if (contextLevel) {
      resolvedContextLevel = CONTEXT_LEVEL_MAP[contextLevel];
    } else if (resolvedType === RoleType.EXECUTIVE) {
      resolvedContextLevel = ContextLevel.ORGANIZATION;
    } else {
      resolvedContextLevel = ContextLevel.MODULE;
    }

    const markdown = this.buildMarkdown(introduction, personalityProfile);

    const created = await this.agents.createAgentAsync(
      {
        name,
        role,
        type: resolvedType,
        contextLevel: resolvedContextLevel,
        specializations,
        reportsTo: reportsTo ?? ctx.agentId,
        personality: personality as PersonalityConfig | undefined,
      },
      markdown ? { markdown } : undefined
    );

    return {
      status: 'ok',
      data: {
        type: 'hire',
        agentId: created.id,
        name: created.name,
        role: created.role,
        specializations: created.specializations ?? [],
        reportsTo: created.reportsTo,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private buildMarkdown(
    introduction: string | undefined,
    personalityProfile: string[] | undefined
  ): string | undefined {
    if (!introduction && !personalityProfile?.length) return undefined;
    if (!this.markdownSectionService) return undefined;
    return this.markdownSectionService.buildAgentMarkdown({
      introduction,
      personalityProfile,
    });
  }
}

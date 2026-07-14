import { z } from 'zod';
import { ContextLevel, RoleType } from '@ai-team/core';
import type {
  ICommand,
  IAgentManager,
  IEmitService,
  ISkillManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type {
  CreateAgentSetupInput,
  CreateOptions,
  CreateSkillSetupInput,
  LlmGenerationParams,
  LlmProfile,
} from '@ai-team/api-contracts';
import type { IQuestionService } from '../../interaction/question-service.js';

type Params = z.infer<typeof CreateICommand.schema>;
const _createICommandSchema = z.object({
  type: z.string().describe('Entity type to create: agent | skill'),
  name: z.string().optional().describe('Name'),
  role: z.string().optional().describe('Role name'),
  interactive: z.boolean().optional().describe('Interactive mode'),
});

export const CreateICommandMetadata = {
  key: 'create',
  description: 'Create a new entity (agent or skill)',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'hr',
  parameters: _createICommandSchema,
} satisfies ICommandDescriptor;

export class CreateICommand implements ICommand<Params, void> {
  static readonly schema = _createICommandSchema;
  readonly metadata = CreateICommandMetadata;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager,
    private readonly interactionService: IQuestionService,
    private readonly emitService: IEmitService
  ) {}

  async execute(payload: Params, _ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const { type, ...options } = payload;
    try {
      switch (type) {
        case 'agent':
          await this.createAgentAsync(options);
          break;
        case 'skill':
          await this.createSkillAsync(options);
          break;
        default:
          throw new Error(`Unknown type: ${type}. Usage: ai-team create <agent|skill>`);
      }
      return { status: 'ok' };
    } catch (error) {
      throw new Error(`Error creating: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async createAgentAsync(options: CreateOptions): Promise<void> {
    if (options.setup?.kind === 'agent') {
      await this.createAgentFromSetupAsync(options.setup);
      this.emitLog(`✓ Agent "${options.setup.name}" created.`);
      return;
    }

    if (options.interactive || (!options.name && !options.role)) {
      const setup = await this.askAgentSetupAsync();
      await this.createAgentFromSetupAsync(setup);
      this.emitLog(`✓ Agent "${setup.name}" created.`);
      return;
    }

    if (!options.name || !options.role) {
      throw new Error('--name and --role are required in non-interactive mode');
    }

    await this.agents.createAgentAsync({
      name: options.name,
      role: options.role,
      contextLevel: ContextLevel.MODULE,
    });
    this.emitLog(`✓ Agent "${options.name}" created.`);
  }

  private async createSkillAsync(options: CreateOptions): Promise<void> {
    if (options.setup?.kind === 'skill') {
      await this.createSkillFromSetupAsync(options.setup);
      this.emitLog(`✓ Skill "${options.setup.name}" created.`);
      return;
    }

    if (options.interactive || !options.name) {
      const setup = await this.askSkillSetupAsync();
      await this.createSkillFromSetupAsync(setup);
      this.emitLog(`✓ Skill "${setup.name}" created.`);
      return;
    }

    throw new Error('Skill creation requires --name or interactive mode.');
  }

  private async createAgentFromSetupAsync(setup: CreateAgentSetupInput): Promise<void> {
    await this.agents.createAgentAsync({
      name: setup.name,
      role: setup.role,
      contextLevel: setup.contextLevel,
      reportsTo: setup.reportsTo,
      features: setup.features,
      llm: setup.llm,
    });
  }

  private async createSkillFromSetupAsync(setup: CreateSkillSetupInput): Promise<void> {
    await this.skills.createSkillAsync(
      {
        name: setup.name,
        type: setup.type,
        description: setup.description,
        contextLevel: setup.contextLevel,
        responsibilities: [],
        tools: [],
        llm: setup.llm,
      },
      setup.instructions
    );
  }

  private async askAgentSetupAsync(): Promise<CreateAgentSetupInput> {
    const name = await this.interactionService.input({
      message: 'Agent name:',
      validate: (v) => (v.length > 0 ? true : 'Name is required'),
    });

    const role = await this.interactionService.input({
      message: 'Role (e.g., senior-developer, tech-lead):',
      validate: (v) => (v.length > 0 ? true : 'Role is required'),
    });

    const contextLevel = (await this.interactionService.select({
      message: 'Context level:',
      choices: Object.values(ContextLevel).map((v) => ({ name: v, value: v })),
      default: ContextLevel.MODULE,
    })) as ContextLevel;

    const reportsTo = await this.interactionService.input({
      message: 'Reports to (agent ID, optional):',
    });

    const featuresRaw = await this.interactionService.input({
      message: 'Features (comma-separated, optional):',
    });

    const features = featuresRaw
      ? featuresRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const llm = await this.askLlmProfileAsync('Add agent-specific LLM overrides?');

    return {
      kind: 'agent',
      name,
      role,
      contextLevel,
      reportsTo: reportsTo || undefined,
      features: features && features.length > 0 ? features : undefined,
      llm,
    };
  }

  private async askSkillSetupAsync(): Promise<CreateSkillSetupInput> {
    const name = await this.interactionService.input({
      message: 'Skill name:',
      validate: (v) => (v.length > 0 ? true : 'Name is required'),
    });

    const type = (await this.interactionService.select({
      message: 'Role type:',
      choices: Object.values(RoleType).map((v) => ({ name: v, value: v })),
    })) as RoleType;

    const description = await this.interactionService.input({
      message: 'Description:',
      validate: (v) => (v.length > 0 ? true : 'Description is required'),
    });

    const contextLevel = (await this.interactionService.select({
      message: 'Context level:',
      choices: Object.values(ContextLevel).map((v) => ({ name: v, value: v })),
    })) as ContextLevel;

    const instructions = await this.interactionService.input({
      message: 'Instructions (detailed text for this skill):',
    });

    const llm = await this.askLlmProfileAsync('Add role-level LLM overrides for this skill?');

    return {
      kind: 'skill',
      name,
      type,
      description,
      contextLevel,
      instructions: instructions || 'Enter detailed instructions for this role...',
      llm,
    };
  }

  private async askLlmProfileAsync(promptMessage: string): Promise<LlmProfile | undefined> {
    if (!this.interactionService.confirm || !this.interactionService.input) {
      return undefined;
    }

    const enabled = await this.interactionService.confirm({
      message: promptMessage,
      default: false,
    });
    if (!enabled) return undefined;

    const provider = await this.interactionService.input({
      message: 'Provider ref or kind (optional):',
    });
    const modelKey = await this.interactionService.input({
      message: 'Model key from provider dictionary (optional):',
    });
    const model = await this.interactionService.input({ message: 'Model override (optional):' });
    const baseUrl = await this.interactionService.input({
      message: 'Base URL override (optional):',
    });

    const tuneParams = await this.interactionService.confirm({
      message: 'Configure advanced generation params?',
      default: false,
    });

    let params: LlmGenerationParams | undefined;
    if (tuneParams) {
      const temperature = await this.interactionService.input({
        message: 'temperature (0-2, optional):',
      });
      const maxTokens = await this.interactionService.input({
        message: 'maxTokens (integer, optional):',
      });
      const topP = await this.interactionService.input({ message: 'topP (0-1, optional):' });
      const presencePenalty = await this.interactionService.input({
        message: 'presencePenalty (-2 to 2, optional):',
      });
      const frequencyPenalty = await this.interactionService.input({
        message: 'frequencyPenalty (-2 to 2, optional):',
      });
      const stopRaw = await this.interactionService.input({
        message: 'stop sequences (comma-separated, optional):',
      });

      const stop = stopRaw
        ? stopRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      params = {
        temperature: CreateICommand.toNumber(temperature),
        maxTokens: CreateICommand.toInt(maxTokens),
        topP: CreateICommand.toNumber(topP),
        presencePenalty: CreateICommand.toNumber(presencePenalty),
        frequencyPenalty: CreateICommand.toNumber(frequencyPenalty),
        stop: stop && stop.length > 0 ? stop : undefined,
      };

      if (Object.values(params).every((v) => v === undefined)) {
        params = undefined;
      }
    }

    const profile: LlmProfile = {
      provider: CreateICommand.toNonEmpty(provider),
      modelKey: CreateICommand.toNonEmpty(modelKey),
      model: CreateICommand.toNonEmpty(model),
      baseUrl: CreateICommand.toNonEmpty(baseUrl),
      params,
    };

    if (Object.values(profile).every((v) => v === undefined)) {
      return undefined;
    }

    return profile;
  }

  private emitLog(message: string): void {
    this.emitService.log('info', message);
  }

  private static toNonEmpty(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private static toNumber(value: string | undefined): number | undefined {
    const s = value?.trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }

  private static toInt(value: string | undefined): number | undefined {
    const s = value?.trim();
    if (!s) return undefined;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  }
}

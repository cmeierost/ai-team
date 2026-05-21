import { ContextLevel, RoleType } from '@ai-team/core';
import type { IAgentManager, ISkillManager } from '@ai-team/core';
import type {
  CreateAgentSetupInput,
  CreateOptions,
  CreateSkillSetupInput,
  LlmProfile,
  LlmGenerationParams,
} from '@ai-team/api-contracts';
import type { IInteractionService } from '../../questions/question-service.js';

export class CreateCommand {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly skillManager: ISkillManager,
    private readonly interactionService: IInteractionService
  ) {}

  async execute(type: string, options: CreateOptions): Promise<void> {
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
    } catch (error) {
      throw new Error(`Error creating: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Agent creation ──────────────────────────────────────────────────────────

  private async createAgentAsync(options: CreateOptions) {
    if (options.setup?.kind === 'agent') {
      await createAgentFromSetupAsync(this.agentManager, options.setup);
      emitLog(this.interactionService, `✓ Agent "${options.setup.name}" created.`);
      return;
    }

    if (options.interactive || (!options.name && !options.role)) {
      const setup = await askAgentSetupAsync(this.interactionService);
      await createAgentFromSetupAsync(this.agentManager, setup);
      emitLog(this.interactionService, `✓ Agent "${setup.name}" created.`);
      return;
    }

    if (!options.name || !options.role) {
      throw new Error('--name and --role are required in non-interactive mode');
    }

    await this.agentManager.createAgentAsync({
      name: options.name,
      role: options.role,
      contextLevel: ContextLevel.MODULE,
    });
    emitLog(this.interactionService, `✓ Agent "${options.name}" created.`);
  }

  // ── Skill creation ──────────────────────────────────────────────────────────

  private async createSkillAsync(options: CreateOptions) {
    if (options.setup?.kind === 'skill') {
      await createSkillFromSetupAsync(this.skillManager, options.setup);
      emitLog(this.interactionService, `✓ Skill "${options.setup.name}" created.`);
      return;
    }

    if (options.interactive || !options.name) {
      const setup = await askSkillSetupAsync(this.interactionService);
      await createSkillFromSetupAsync(this.skillManager, setup);
      emitLog(this.interactionService, `✓ Skill "${setup.name}" created.`);
      return;
    }

    throw new Error('Skill creation requires --name or interactive mode.');
  }
}

// ── Persistence helpers ───────────────────────────────────────────────────────

async function createAgentFromSetupAsync(
  agentManager: IAgentManager,
  setup: CreateAgentSetupInput
) {
  await agentManager.createAgentAsync({
    name: setup.name,
    role: setup.role,
    contextLevel: setup.contextLevel,
    reportsTo: setup.reportsTo,
    features: setup.features,
    llm: setup.llm,
  });
}

async function createSkillFromSetupAsync(
  skillManager: ISkillManager,
  setup: CreateSkillSetupInput
) {
  await skillManager.createSkillAsync(
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

// ── Interactive question flows ────────────────────────────────────────────────

async function askAgentSetupAsync(
  interactionService: IInteractionService
): Promise<CreateAgentSetupInput> {
  const name = await interactionService.input({
    message: 'Agent name:',
    validate: (v) => (v.length > 0 ? true : 'Name is required'),
  });

  const role = await interactionService.input({
    message: 'Role (e.g., senior-developer, tech-lead):',
    validate: (v) => (v.length > 0 ? true : 'Role is required'),
  });

  const contextLevel = (await interactionService.select({
    message: 'Context level:',
    choices: Object.values(ContextLevel).map((v) => ({ name: v, value: v })),
    default: ContextLevel.MODULE,
  })) as ContextLevel;

  const reportsTo = await interactionService.input({
    message: 'Reports to (agent ID, optional):',
  });

  const featuresRaw = await interactionService.input({
    message: 'Features (comma-separated, optional):',
  });

  const features = featuresRaw
    ? featuresRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const llm = await askLlmProfileAsync(interactionService, 'Add agent-specific LLM overrides?');

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

async function askSkillSetupAsync(
  questionService: IInteractionService
): Promise<CreateSkillSetupInput> {
  const name = await questionService.input({
    message: 'Skill name:',
    validate: (v) => (v.length > 0 ? true : 'Name is required'),
  });

  const type = (await questionService.select({
    message: 'Role type:',
    choices: Object.values(RoleType).map((v) => ({ name: v, value: v })),
  })) as RoleType;

  const description = await questionService.input({
    message: 'Description:',
    validate: (v) => (v.length > 0 ? true : 'Description is required'),
  });

  const contextLevel = (await questionService.select({
    message: 'Context level:',
    choices: Object.values(ContextLevel).map((v) => ({ name: v, value: v })),
  })) as ContextLevel;

  const instructions = await questionService.input({
    message: 'Instructions (detailed text for this skill):',
  });

  const llm = await askLlmProfileAsync(
    questionService,
    'Add role-level LLM overrides for this skill?'
  );

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

async function askLlmProfileAsync(
  questionService: IInteractionService,
  promptMessage: string
): Promise<LlmProfile | undefined> {
  if (!questionService.confirm || !questionService.input) {
    return undefined;
  }

  const enabled = await questionService.confirm({
    message: promptMessage,
    default: false,
  });
  if (!enabled) return undefined;

  const provider = await questionService.input({ message: 'Provider ref or kind (optional):' });
  const modelKey = await questionService.input({
    message: 'Model key from provider dictionary (optional):',
  });
  const model = await questionService.input({ message: 'Model override (optional):' });
  const baseUrl = await questionService.input({ message: 'Base URL override (optional):' });

  const tuneParams = await questionService.confirm({
    message: 'Configure advanced generation params?',
    default: false,
  });

  let params: LlmGenerationParams | undefined;
  if (tuneParams) {
    const temperature = await questionService.input({ message: 'temperature (0-2, optional):' });
    const maxTokens = await questionService.input({ message: 'maxTokens (integer, optional):' });
    const topP = await questionService.input({ message: 'topP (0-1, optional):' });
    const presencePenalty = await questionService.input({
      message: 'presencePenalty (-2 to 2, optional):',
    });
    const frequencyPenalty = await questionService.input({
      message: 'frequencyPenalty (-2 to 2, optional):',
    });
    const stopRaw = await questionService.input({
      message: 'stop sequences (comma-separated, optional):',
    });

    const stop = stopRaw
      ? stopRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    params = {
      temperature: toNumber(temperature),
      maxTokens: toInt(maxTokens),
      topP: toNumber(topP),
      presencePenalty: toNumber(presencePenalty),
      frequencyPenalty: toNumber(frequencyPenalty),
      stop: stop && stop.length > 0 ? stop : undefined,
    };

    if (Object.values(params).every((v) => v === undefined)) {
      params = undefined;
    }
  }

  const profile: LlmProfile = {
    provider: toNonEmpty(provider),
    modelKey: toNonEmpty(modelKey),
    model: toNonEmpty(model),
    baseUrl: toNonEmpty(baseUrl),
    params,
  };

  if (Object.values(profile).every((v) => v === undefined)) {
    return undefined;
  }

  return profile;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function emitLog(context: IInteractionService, message: string) {
  context.emit?.({ kind: 'log', level: 'info', message });
}

function toNonEmpty(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toNumber(value: string | undefined): number | undefined {
  const s = value?.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function toInt(value: string | undefined): number | undefined {
  const s = value?.trim();
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

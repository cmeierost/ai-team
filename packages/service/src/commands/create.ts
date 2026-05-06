import { ContextLevel, RoleType } from '@ai-team/core';
import type { IAgentManager, ISkillManager } from '@ai-team/core';
import type {
  CreateAgentSetupInput,
  CreateOptions,
  CreateSkillSetupInput,
  InteractionContext,
  LlmProfile,
  LlmGenerationParams,
} from '@ai-team/api-contracts';

export class CreateCommand {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly skillManager: ISkillManager
  ) {}

  async execute(
    type: string,
    options: CreateOptions,
    context: InteractionContext = {}
  ): Promise<void> {
    try {
      switch (type) {
        case 'agent':
          await this.createAgentAsync(options, context);
          break;
        case 'skill':
          await this.createSkillAsync(options, context);
          break;
        default:
          throw new Error(`Unknown type: ${type}. Usage: ai-team create <agent|skill>`);
      }
    } catch (error) {
      throw new Error(`Error creating: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Agent creation ──────────────────────────────────────────────────────────

  private async createAgentAsync(options: CreateOptions, context: InteractionContext) {
    if (options.setup?.kind === 'agent') {
      await createAgentFromSetupAsync(this.agentManager, options.setup);
      emitLog(context, `✓ Agent "${options.setup.name}" created.`);
      return;
    }

    if (options.interactive || (!options.name && !options.role)) {
      const setup = await askAgentSetupAsync(context);
      await createAgentFromSetupAsync(this.agentManager, setup);
      emitLog(context, `✓ Agent "${setup.name}" created.`);
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
    emitLog(context, `✓ Agent "${options.name}" created.`);
  }

  // ── Skill creation ──────────────────────────────────────────────────────────

  private async createSkillAsync(options: CreateOptions, context: InteractionContext) {
    if (options.setup?.kind === 'skill') {
      await createSkillFromSetupAsync(this.skillManager, options.setup);
      emitLog(context, `✓ Skill "${options.setup.name}" created.`);
      return;
    }

    if (options.interactive || !options.name) {
      const setup = await askSkillSetupAsync(context);
      await createSkillFromSetupAsync(this.skillManager, setup);
      emitLog(context, `✓ Skill "${setup.name}" created.`);
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

async function askAgentSetupAsync(context: InteractionContext): Promise<CreateAgentSetupInput> {
  if (!context.questionInput || !context.questionSelect) {
    throw new Error('Interactive agent creation requires question responders.');
  }

  const name = await context.questionInput({
    message: 'Agent name:',
    validate: (v) => (v.length > 0 ? true : 'Name is required'),
  });

  const role = await context.questionInput({
    message: 'Role (e.g., senior-developer, tech-lead):',
    validate: (v) => (v.length > 0 ? true : 'Role is required'),
  });

  const contextLevel = (await context.questionSelect({
    message: 'Context level:',
    choices: Object.values(ContextLevel).map((v) => ({ name: v, value: v })),
    default: ContextLevel.MODULE,
  })) as ContextLevel;

  const reportsTo = await context.questionInput({
    message: 'Reports to (agent ID, optional):',
  });

  const featuresRaw = await context.questionInput({
    message: 'Features (comma-separated, optional):',
  });

  const features = featuresRaw
    ? featuresRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const llm = await askLlmProfileAsync(context, 'Add agent-specific LLM overrides?');

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

async function askSkillSetupAsync(context: InteractionContext): Promise<CreateSkillSetupInput> {
  if (!context.questionInput || !context.questionSelect) {
    throw new Error('Interactive skill creation requires question responders.');
  }

  const name = await context.questionInput({
    message: 'Skill name:',
    validate: (v) => (v.length > 0 ? true : 'Name is required'),
  });

  const type = (await context.questionSelect({
    message: 'Role type:',
    choices: Object.values(RoleType).map((v) => ({ name: v, value: v })),
  })) as RoleType;

  const description = await context.questionInput({
    message: 'Description:',
    validate: (v) => (v.length > 0 ? true : 'Description is required'),
  });

  const contextLevel = (await context.questionSelect({
    message: 'Context level:',
    choices: Object.values(ContextLevel).map((v) => ({ name: v, value: v })),
  })) as ContextLevel;

  const instructions = await context.questionInput({
    message: 'Instructions (detailed text for this skill):',
  });

  const llm = await askLlmProfileAsync(context, 'Add role-level LLM overrides for this skill?');

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
  context: InteractionContext,
  promptMessage: string
): Promise<LlmProfile | undefined> {
  if (!context.questionConfirm || !context.questionInput) {
    return undefined;
  }

  const enabled = await context.questionConfirm({
    message: promptMessage,
    default: false,
  });
  if (!enabled) return undefined;

  const provider = await context.questionInput({ message: 'Provider ref or kind (optional):' });
  const modelKey = await context.questionInput({
    message: 'Model key from provider dictionary (optional):',
  });
  const model = await context.questionInput({ message: 'Model override (optional):' });
  const baseUrl = await context.questionInput({ message: 'Base URL override (optional):' });

  const tuneParams = await context.questionConfirm({
    message: 'Configure advanced generation params?',
    default: false,
  });

  let params: LlmGenerationParams | undefined;
  if (tuneParams) {
    const temperature = await context.questionInput({ message: 'temperature (0-2, optional):' });
    const maxTokens = await context.questionInput({ message: 'maxTokens (integer, optional):' });
    const topP = await context.questionInput({ message: 'topP (0-1, optional):' });
    const presencePenalty = await context.questionInput({
      message: 'presencePenalty (-2 to 2, optional):',
    });
    const frequencyPenalty = await context.questionInput({
      message: 'frequencyPenalty (-2 to 2, optional):',
    });
    const stopRaw = await context.questionInput({
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

function emitLog(context: InteractionContext, message: string) {
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
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

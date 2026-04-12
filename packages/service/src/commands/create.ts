import { AgentManager, SkillManager, ContextLevel } from '@ai-team/infrastructure';
import type {
  CreateAgentSetupInput,
  CreateOptions,
  CreateSkillSetupInput,
} from '@ai-team/api-client';

export async function createCommand(workspaceRoot: string, type: string, options: CreateOptions) {
  try {
    switch (type) {
      case 'agent':
        await createAgentAsync(workspaceRoot, options);
        break;
      case 'skill':
        await createSkillAsync(workspaceRoot, options);
        break;
      default:
        throw new Error(`Unknown type: ${type}. Usage: ai-team create <agent|skill>`);
    }
  } catch (error) {
    throw new Error(`Error creating: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createAgentAsync(workspaceRoot: string, options: CreateOptions) {
  const agentManager = new AgentManager(workspaceRoot);

  if (options.setup?.kind === 'agent') {
    await createAgentFromSetupAsync(agentManager, options.setup);
    return;
  }

  if (options.interactive || (!options.name && !options.role)) {
    throw new Error('Interactive create requires client-provided setup payload.');
  }

  if (!options.name || !options.role) {
    throw new Error('--name and --role are required in non-interactive mode');
  }

  const config = {
    name: options.name,
    role: options.role,
    contextLevel: ContextLevel.MODULE,
  };

  await agentManager.createAgentAsync(config);
}

async function createSkillAsync(workspaceRoot: string, _options: CreateOptions) {
  const skillManager = new SkillManager(workspaceRoot);

  if (_options.setup?.kind === 'skill') {
    await createSkillFromSetupAsync(skillManager, _options.setup);
    return;
  }

  throw new Error('Skill creation requires client-provided setup payload.');
}

async function createAgentFromSetupAsync(agentManager: AgentManager, setup: CreateAgentSetupInput) {
  await agentManager.createAgentAsync({
    name: setup.name,
    role: setup.role,
    contextLevel: setup.contextLevel,
    reportsTo: setup.reportsTo,
    features: setup.features,
    llm: setup.llm,
  });
}

async function createSkillFromSetupAsync(skillManager: SkillManager, setup: CreateSkillSetupInput) {
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

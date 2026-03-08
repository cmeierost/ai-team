import { AgentManager, SkillManager, ContextLevel } from '@ai-team/core';
import type { CreateAgentSetupInput, CreateOptions, CreateSkillSetupInput } from '../contracts.js';

export async function createCommand(workspaceRoot: string, type: string, options: CreateOptions) {
  try {
    switch (type) {
      case 'agent':
        await createAgent(workspaceRoot, options);
        break;
      case 'skill':
        await createSkill(workspaceRoot, options);
        break;
      default:
        throw new Error(`Unknown type: ${type}. Usage: ai-team create <agent|skill>`);
    }
  } catch (error) {
    throw new Error(`Error creating: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createAgent(workspaceRoot: string, options: CreateOptions) {
  const agentManager = new AgentManager(workspaceRoot);
  await agentManager.initialize();

  if (options.setup?.kind === 'agent') {
    await createAgentFromSetup(agentManager, options.setup);
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

  const agent = await agentManager.createAgent(config);
  void agent;
}

async function createSkill(workspaceRoot: string, _options: CreateOptions) {
  const skillManager = new SkillManager(workspaceRoot);
  await skillManager.initialize();

  if (_options.setup?.kind === 'skill') {
    await createSkillFromSetup(skillManager, _options.setup);
    return;
  }

  throw new Error('Skill creation requires client-provided setup payload.');
}

async function createAgentFromSetup(agentManager: AgentManager, setup: CreateAgentSetupInput) {
  const agent = await agentManager.createAgent({
    name: setup.name,
    role: setup.role,
    contextLevel: setup.contextLevel,
    reportsTo: setup.reportsTo,
    features: setup.features,
    llm: setup.llm,
  });
  void agent;
}

async function createSkillFromSetup(skillManager: SkillManager, setup: CreateSkillSetupInput) {
  const skill = await skillManager.createSkill(
    {
      name: setup.name,
      type: setup.type,
      description: setup.description,
      contextLevel: setup.contextLevel,
      responsibilities: [],
      tools: [],
      permissions: { read: [], write: [] },
      llm: setup.llm,
    },
    setup.instructions,
  );
  void skill;
}

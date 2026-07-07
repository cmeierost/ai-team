import ora from 'ora';
import type {
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';
import type { IModelDiscoveryRegistry } from '@ai-team/core';

export interface LlmSetupResult {
  provider: string;
  providerRef?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface LlmSettingsIo {
  select(request: QuestionSelectRequest): Promise<string>;
  input(request: QuestionInputRequest): Promise<string>;
  password(request: QuestionPasswordRequest): Promise<string>;
  writeLine(message: string): void;
  writeWarn(message: string): void;
}

export async function askLlmSetup(
  io: LlmSettingsIo,
  modelDiscoveryRegistry: IModelDiscoveryRegistry
): Promise<LlmSetupResult> {
  const provider = await io.select({
    message: 'Which LLM provider do you want to use?',
    choices: [
      {
        name: 'OpenAI-compatible — any endpoint that speaks the OpenAI API (OpenAI, Ollama, LM Studio, Azure, etc.)',
        value: 'openai-compatible' as const,
      },
      {
        name: 'GitHub Copilot  — uses your existing Copilot subscription',
        value: 'github-copilot' as const,
      },
    ],
  });

  if (provider === 'github-copilot') {
    return askGitHubCopilotSetup(io, modelDiscoveryRegistry);
  }

  return askOpenAICompatibleSetup(io);
}

export function providerNameToProviderRef(providerName: string): string {
  const normalized = providerName.trim().toLowerCase();
  const slug = normalized.replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
  return slug || 'openai-compatible';
}

async function askGitHubCopilotSetup(
  io: LlmSettingsIo,
  modelDiscoveryRegistry: IModelDiscoveryRegistry
): Promise<LlmSetupResult> {
  io.writeLine('');
  io.writeLine('  GitHub Copilot will use your active VS Code / CLI session.');

  const spinner = ora('Fetching available models from GitHub Copilot…').start();
  const discovery = modelDiscoveryRegistry.getForKind('github-copilot');
  const models = discovery ? await discovery.fetchModelsAsync() : [];
  spinner.stop();

  let choices: { name: string; value: string }[];

  if (models.length > 0) {
    choices = models.map((m) => ({
      name: m.name,
      value: m.name,
    }));
  } else {
    io.writeWarn('  Could not fetch models - showing defaults.');
    choices = [
      { name: 'GPT-4o', value: 'gpt-4o' },
      { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
      { name: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
    ];
  }

  const model = await io.select({
    message: 'Which model?',
    choices,
  });

  return {
    provider: 'github-copilot',
    model,
  };
}

async function askOpenAICompatibleSetup(io: LlmSettingsIo): Promise<LlmSetupResult> {
  const providerName = await io.input({
    message: 'Provider name:',
    validate: (value: string) => value.trim().length > 0 || 'Provider name is required.',
  });

  const providerRef = providerNameToProviderRef(providerName);

  io.writeLine(`  Provider key: ${providerRef}`);

  const baseUrl = await io.input({
    message: 'Base URL:',
    validate: (val: string) => {
      try {
        new URL(val);
        return true;
      } catch {
        return 'Please enter a valid URL';
      }
    },
  });

  const apiKey = await io.password({
    message: 'API key:',
    mask: '*',
  });

  const modelChoices = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'].map((m) => ({
    name: m,
    value: m,
  }));
  modelChoices.push({ name: 'Other (type manually)', value: '__custom__' });

  const modelChoice = await io.select({
    message: 'Which model?',
    choices: modelChoices,
  });

  let model: string;
  if (modelChoice === '__custom__') {
    model = await io.input({ message: 'Model name:' });
  } else if (modelChoice === '(uses loaded model)') {
    model = '';
  } else {
    model = modelChoice;
  }

  return {
    provider: 'openai-compatible',
    providerRef,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
  };
}

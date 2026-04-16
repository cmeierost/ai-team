import ora from 'ora';
import { fetchGitHubModels } from '@ai-team/infrastructure';
import type {
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-client';

export interface LlmSetupResult {
  provider: string;
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

export async function askLlmSetup(io: LlmSettingsIo): Promise<LlmSetupResult> {
  const provider = await io.select({
    message: 'Which LLM provider do you want to use?',
    choices: [
      {
        name: 'GitHub Copilot  — uses your existing Copilot subscription',
        value: 'github-copilot' as const,
      },
      {
        name: 'OpenAI-compatible — any endpoint that speaks the OpenAI API (OpenAI, Ollama, LM Studio, Azure, etc.)',
        value: 'openai-compatible' as const,
      },
    ],
  });

  if (provider === 'github-copilot') {
    return askGitHubCopilotSetup(io);
  }

  return askOpenAICompatibleSetup(io);
}

async function askGitHubCopilotSetup(io: LlmSettingsIo): Promise<LlmSetupResult> {
  io.writeLine('');
  io.writeLine('  GitHub Copilot will use your active VS Code / CLI session.');

  const spinner = ora('Fetching available models from GitHub Copilot…').start();
  const models = await fetchGitHubModels();
  spinner.stop();

  let choices: { name: string; value: string }[];

  if (models.length > 0) {
    choices = models.map((m) => ({
      name: m.name,
      value: m.id,
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
  const preset = await io.select({
    message: 'Which service?',
    choices: [
      { name: 'OpenAI              (api.openai.com)', value: 'openai' },
      { name: 'Ollama — local      (localhost:11434)', value: 'ollama' },
      { name: 'LM Studio — local   (localhost:1234)', value: 'lmstudio' },
      { name: 'Azure OpenAI', value: 'azure' },
      { name: 'Custom URL', value: 'custom' },
    ],
  });

  const presets: Record<string, { baseUrl: string; needsKey: boolean; models: string[] }> = {
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      needsKey: true,
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
    },
    ollama: {
      baseUrl: 'http://localhost:11434/v1',
      needsKey: false,
      models: ['llama3', 'mistral', 'codellama', 'deepseek-coder'],
    },
    lmstudio: {
      baseUrl: 'http://localhost:1234/v1',
      needsKey: false,
      models: ['(uses loaded model)'],
    },
    azure: { baseUrl: '', needsKey: true, models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  };

  const info = presets[preset];

  let baseUrl: string;
  if (preset === 'custom' || preset === 'azure') {
    baseUrl = await io.input({
      message: preset === 'azure' ? 'Azure endpoint URL:' : 'Base URL:',
      validate: (val: string) => {
        try {
          new URL(val);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    });
  } else {
    baseUrl = info.baseUrl;
  }

  let apiKey = '';
  const needsKey = info ? info.needsKey : true;
  if (needsKey) {
    apiKey = await io.password({
      message: 'API key:',
      mask: '*',
    });
  }

  const modelChoices = (info?.models || ['gpt-4o']).map((m) => ({ name: m, value: m }));
  if (preset !== 'lmstudio') {
    modelChoices.push({ name: 'Other (type manually)', value: '__custom__' });
  }

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
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
  };
}

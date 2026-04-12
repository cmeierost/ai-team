import { confirm, input, password, select } from '@inquirer/prompts';
import type {
  AddProviderOptions,
  IAiTeamMediator,
  ConfigureProviderOptions,
  ProviderSetupInput,
  SetProviderOptions,
} from '@ai-team/api-client';
import { fetchGitHubModels, loadEnvFile, loadTeamConfig } from '@ai-team/infrastructure';
import type { LlmConfig, LlmProviderConfig, TeamConfig } from '@ai-team/infrastructure';
import { runCommandStream } from './stream-runner.js';

export async function providerConfigureCommand(
  client: IAiTeamMediator,
  options: ConfigureProviderOptions = {}
) {
  if (!options.fromInit) {
    const workspaceRoot = process.cwd();
    const existing = await loadTeamConfig(workspaceRoot);
    const currentDefault = resolveCurrentDefaultProvider(existing);

    if (currentDefault) {
      const keep = await confirm({
        message: `Current default provider is '${currentDefault.ref}' (${currentDefault.config.kind}). Keep it?`,
        default: true,
      });

      if (keep) {
        await runCommandStream(client, {
          command: 'providerConfigure',
          payload: { options: { ...options, keepCurrentDefault: true } },
        });
        return;
      }
    }

    const setup = await askProviderSetup(workspaceRoot, existing, { mode: 'configure' });
    await runCommandStream(client, {
      command: 'providerConfigure',
      payload: { options: { ...options, keepCurrentDefault: false, setup } },
    });
    return;
  }

  await runCommandStream(client, {
    command: 'providerConfigure',
    payload: { options },
  });
}

export async function providerAddCommand(
  client: IAiTeamMediator,
  options: AddProviderOptions = {}
) {
  if (options.setup) {
    await runCommandStream(client, {
      command: 'providerAdd',
      payload: { options },
    });
    return;
  }

  const workspaceRoot = process.cwd();
  const existing = await loadTeamConfig(workspaceRoot);
  const setup = await askProviderSetup(workspaceRoot, existing, { mode: 'add' });
  const makeDefault = await confirm({
    message: `Make '${setup.providerRef}' the default provider?`,
    default: false,
  });

  await runCommandStream(client, {
    command: 'providerAdd',
    payload: { options: { setup, makeDefault } },
  });
}

export async function providerSetCommand(
  client: IAiTeamMediator,
  options: SetProviderOptions = {}
) {
  if (!options.fromInit) {
    const workspaceRoot = process.cwd();
    const existing = await loadTeamConfig(workspaceRoot);
    const currentDefault = resolveCurrentDefaultProvider(existing);

    if (currentDefault) {
      const keep = await confirm({
        message: `Current default provider is '${currentDefault.ref}' (${currentDefault.config.kind}). Keep it?`,
        default: true,
      });

      if (keep) {
        await runCommandStream(client, {
          command: 'providerSet',
          payload: { options: { ...options, keepCurrentDefault: true } },
        });
        return;
      }
    }

    const setup = await askProviderSetup(workspaceRoot, existing, { mode: 'configure' });
    await runCommandStream(client, {
      command: 'providerSet',
      payload: { options: { ...options, keepCurrentDefault: false, setup } },
    });
    return;
  }

  await runCommandStream(client, {
    command: 'providerSet',
    payload: { options },
  });
}

export default providerConfigureCommand;

async function askProviderSetup(
  workspaceRoot: string,
  existing: TeamConfig | undefined,
  options: { mode: 'configure' | 'add' }
): Promise<ProviderSetupInput> {
  const providerKind = await select<'github-copilot' | 'openai-compatible'>({
    message:
      options.mode === 'configure'
        ? 'Which provider should be configured as default?'
        : 'Which provider do you want to add?',
    choices: [
      { name: 'GitHub Copilot', value: 'github-copilot' },
      { name: 'OpenAI-compatible (OpenAI, Ollama, Azure, etc.)', value: 'openai-compatible' },
    ],
  });

  if (providerKind === 'github-copilot') {
    const models = await fetchGitHubModels();
    const modelChoices = (
      models.length > 0
        ? models.map((model) => ({ name: model.name, value: model.id }))
        : [
            { name: 'GPT-4o', value: 'gpt-4o' },
            { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
            { name: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
          ]
    ) as { name: string; value: string }[];

    const model = await select({
      message: 'Which model?',
      choices: modelChoices,
    });

    const suggestedRef = buildProviderRef({ provider: 'github-copilot', model }, existing);
    const providerRef = await input({
      message: 'Provider reference key (used in config.providers):',
      default: suggestedRef,
      validate: validateProviderRef,
    });

    const providerConfig: LlmProviderConfig = {
      kind: 'github-copilot',
      models: [{ name: model }],
    };

    return {
      providerRef,
      providerConfig,
      legacyLlm: {
        provider: 'github-copilot',
        model,
      },
    };
  }

  const preset = await select({
    message: 'Which service?',
    choices: [
      { name: 'OpenAI (api.openai.com)', value: 'openai' },
      { name: 'Ollama — local', value: 'ollama' },
      { name: 'LM Studio — local', value: 'lmstudio' },
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

  const presetInfo = presets[preset];

  let baseUrl: string;
  if (preset === 'custom' || preset === 'azure') {
    baseUrl = await input({
      message: preset === 'azure' ? 'Azure endpoint URL:' : 'Base URL:',
      validate: (value: string) => {
        try {
          new URL(value);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    });
  } else {
    baseUrl = presetInfo.baseUrl;
  }

  const modelChoices = (presetInfo?.models || ['gpt-4o']).map((modelId) => ({
    name: modelId,
    value: modelId,
  }));
  if (preset !== 'lmstudio') {
    modelChoices.push({ name: 'Other (type manually)', value: '__custom__' });
  }

  const modelChoice = await select({
    message: 'Which model?',
    choices: modelChoices,
  });

  const model =
    modelChoice === '__custom__'
      ? await input({ message: 'Model name:' })
      : modelChoice === '(uses loaded model)'
        ? ''
        : modelChoice;

  const suggestedRef = buildProviderRef(
    { provider: 'openai-compatible', baseUrl, ...(model ? { model } : {}) },
    existing
  );

  const providerRef = await input({
    message: 'Provider reference key (used in config.providers):',
    default: suggestedRef,
    validate: validateProviderRef,
  });

  const needsKey = presetInfo ? presetInfo.needsKey : true;
  let apiKeyEnvVar: string | undefined;
  let apiKey: string | undefined;

  if (needsKey) {
    const envVars = await loadEnvFile(workspaceRoot);
    const existingRefConfig = (existing?.providers || {})[providerRef];
    const defaultEnvVar =
      existingRefConfig?.apiKeyEnvVar ||
      `${providerRef.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

    apiKeyEnvVar = await input({
      message:
        'API key environment variable name (stored in config, value stays in .ai-team/.env):',
      default: defaultEnvVar,
      validate: (value: string) =>
        /^[A-Z_][A-Z0-9_]*$/.test(value.trim()) ||
        'Use uppercase letters, numbers, and underscores only.',
    });

    const existingValue = envVars[apiKeyEnvVar];
    if (existingValue) {
      const useExisting = await confirm({
        message: `Use existing value for ${apiKeyEnvVar} from .ai-team/.env?`,
        default: true,
      });

      if (!useExisting) {
        apiKey = await password({
          message: `New value for ${apiKeyEnvVar}:`,
          mask: '*',
          validate: (value) => value.trim().length > 0 || 'API key cannot be empty',
        });
      }
    } else {
      const saveNow = await confirm({
        message: `No value for ${apiKeyEnvVar} found in .ai-team/.env. Save one now?`,
        default: true,
      });

      if (saveNow) {
        apiKey = await password({
          message: `Value for ${apiKeyEnvVar}:`,
          mask: '*',
          validate: (value) => value.trim().length > 0 || 'API key cannot be empty',
        });
      }
    }
  }

  const providerConfig: LlmProviderConfig = {
    kind: 'openai-compatible',
    baseUrl,
    ...(model ? { defaultModel: model, models: [{ name: model }] } : {}),
    ...(apiKeyEnvVar ? { apiKeyEnvVar } : {}),
  };

  const legacyLlm: LlmConfig = {
    provider: 'openai-compatible',
    baseUrl,
    ...(model ? { model } : {}),
  };

  return {
    providerRef,
    providerConfig,
    legacyLlm,
    apiKeyEnvVar,
    apiKey,
  };
}

function resolveCurrentDefaultProvider(
  config: TeamConfig | undefined
): { ref: string; config: LlmProviderConfig } | undefined {
  const registry = config?.providers;
  if (!registry || Object.keys(registry).length === 0) {
    return undefined;
  }

  if (config?.defaultModel?.provider && registry[config.defaultModel.provider]) {
    return { ref: config.defaultModel.provider, config: registry[config.defaultModel.provider] };
  }

  const byDefaultModel = Object.entries(registry).find(([, provider]) => provider.defaultModel);
  if (byDefaultModel) {
    return { ref: byDefaultModel[0], config: byDefaultModel[1] };
  }

  const first = Object.keys(registry)[0];
  return {
    ref: first,
    config: registry[first],
  };
}

function buildProviderRef(llm: LlmConfig, existing?: TeamConfig): string {
  if (llm.provider === 'github-copilot') {
    return 'github-copilot';
  }

  if (!llm.baseUrl) {
    return 'openai-compatible';
  }

  try {
    const host = new URL(llm.baseUrl).hostname.toLowerCase();
    const sanitized = host.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const baseRef = sanitized || 'openai-compatible';

    const existingRefs = new Set(Object.keys(existing?.providers || {}));
    if (!existingRefs.has(baseRef)) {
      return baseRef;
    }

    let index = 2;
    while (existingRefs.has(`${baseRef}-${index}`)) {
      index += 1;
    }
    return `${baseRef}-${index}`;
  } catch {
    return 'openai-compatible';
  }
}

function validateProviderRef(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Provider reference is required';
  }
  if (!/^[a-z0-9][a-z0-9-_.]*$/i.test(trimmed)) {
    return 'Use letters, numbers, and -_. only';
  }
  return true;
}

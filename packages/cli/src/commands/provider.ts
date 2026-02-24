import path from 'path';
import chalk from 'chalk';
import { select, input, password } from '@inquirer/prompts';
import {
  loadTeamConfig,
  saveTeamConfig,
  saveEnvFile,
  testLlmConnection,
  fetchGitHubModels,
  resolveEffectiveLlmSettings,
} from '@ai-team/core';
import type { LlmConfig, TeamConfig, LlmProviderConfig } from '@ai-team/core';

export async function providerSetCommand() {
  const workspaceRoot = process.cwd();

  const existing = await loadTeamConfig(workspaceRoot);

  const provider = await select<"github-copilot" | "openai-compatible">({
    message: 'Which LLM provider do you want to use?',
    choices: [
      { name: 'GitHub Copilot', value: 'github-copilot' },
      { name: 'OpenAI-compatible (OpenAI, Ollama, Azure, etc.)', value: 'openai-compatible' },
    ],
  });

  let llm: LlmConfig;
  let apiKey: string | undefined;

  if (provider === 'github-copilot') {
    console.log(chalk.dim('\n GitHub Copilot will use your active VS Code / CLI session.'));
    const spinnerModels = await fetchGitHubModels();
    const modelChoices = (spinnerModels.length > 0
      ? spinnerModels.map(m => ({ name: m.name, value: m.id }))
      : [
          { name: 'GPT-4o', value: 'gpt-4o' },
          { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
          { name: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
        ]) as { name: string; value: string }[];

    const model = await select({ message: 'Which model?', choices: modelChoices });
    llm = { provider: 'github-copilot', model };
  } else {
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
      openai:   { baseUrl: 'https://api.openai.com/v1', needsKey: true,  models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'] },
      ollama:   { baseUrl: 'http://localhost:11434/v1',  needsKey: false, models: ['llama3', 'mistral'] },
      lmstudio: { baseUrl: 'http://localhost:1234/v1',   needsKey: false, models: ['(uses loaded model)'] },
      azure:    { baseUrl: '',                           needsKey: true,  models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
    };

    const info = presets[preset];

    let baseUrl: string;
    if (preset === 'custom' || preset === 'azure') {
      baseUrl = await input({ message: preset === 'azure' ? 'Azure endpoint URL:' : 'Base URL:', validate: (val: string) => { try { new URL(val); return true; } catch { return 'Please enter a valid URL'; } } });
    } else {
      baseUrl = info.baseUrl;
    }

    let key = '';
    const needsKey = info ? info.needsKey : true;
    if (needsKey) {
      key = await password({ message: 'API key:', mask: '*' });
    }

    const modelChoices = (info?.models || ['gpt-4o']).map(m => ({ name: m, value: m }));
    if (preset !== 'lmstudio') modelChoices.push({ name: 'Other (type manually)', value: '__custom__' });

    const modelChoice = await select({ message: 'Which model?', choices: modelChoices });
    let model: string = '';
    if (modelChoice === '__custom__') {
      model = await input({ message: 'Model name:' });
    } else if (modelChoice === '(uses loaded model)') {
      model = '';
    } else {
      model = modelChoice;
    }

    apiKey = key || undefined;
    llm = { provider: 'openai-compatible', baseUrl, ...(model ? { model } : {}) } as LlmConfig;
  }

  const teamConfig: TeamConfig = existing || { version: '0.1.0' } as TeamConfig;
  const providerRef = buildProviderRef(llm, existing);

  const models = llm.model ? { [toModelKey(llm.model)]: llm.model } : undefined;
  const defaultModelKey = llm.model ? toModelKey(llm.model) : undefined;

  const providerConfig: LlmProviderConfig = {
    kind: llm.provider as 'github-copilot' | 'openai-compatible',
    isDefault: true,
    model: llm.model,
    defaultModelKey,
    models,
    baseUrl: llm.baseUrl,
  };

  const registry = { ...(teamConfig.providers || teamConfig.llmProviders || {}) };
  for (const key of Object.keys(registry)) {
    registry[key] = { ...registry[key], isDefault: false };
  }
  registry[providerRef] = providerConfig;

  teamConfig.providers = registry;
  teamConfig.defaultLlmProvider = providerRef;
  teamConfig.llmProviders = registry;
  teamConfig.llm = llm;

  await saveTeamConfig(workspaceRoot, teamConfig);
  if (apiKey) {
    await saveEnvFile(workspaceRoot, { AI_TEAM_LLM_API_KEY: apiKey });
  }

  console.log(chalk.green('\nSaved provider settings to .ai-team/config.json'));

  // Run test-connection
  try {
    const resolved = resolveEffectiveLlmSettings(teamConfig);
    const reply = await testLlmConnection(resolved.config, apiKey);
    console.log(chalk.green('LLM connection working!'), reply ? `Response: ${reply}` : '');
  } catch (err) {
    console.error(chalk.red('LLM connection failed'));
    if (err instanceof Error) console.error(chalk.dim(err.message));
    console.log(chalk.dim('\nRun `ait test-connection` to retry later.'));
  }
}

function buildProviderRef(llm: LlmConfig, existing?: TeamConfig): string {
  if (llm.provider === 'github-copilot') {
    return 'github-copilot';
  }

  const baseUrl = llm.baseUrl;
  if (!baseUrl) {
    return 'openai-compatible';
  }

  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    const sanitized = host.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const baseRef = sanitized || 'openai-compatible';

    const existingRefs = new Set(Object.keys(existing?.providers || existing?.llmProviders || {}));
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

function toModelKey(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'default-model';
}

export default providerSetCommand;

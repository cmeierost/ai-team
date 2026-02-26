import {
  AgentManager,
  loadEnvFile,
  loadSkill,
  loadTeamConfig,
  resolveEffectiveLlmSettings,
  testLlmConnection,
} from '@ai-team/core';
import type { ResolvedLlmSettings } from '@ai-team/core';

import { TestConnectionOptions } from '../contracts.js';

export async function testConnectionCommand(workspaceRoot: string, options: TestConnectionOptions = {}): Promise<void> {
  if (options.model && options.modelKey) {
    throw new Error('Use either --model or --model-key, not both.');
  }

  if (options.all && (options.model || options.modelKey)) {
    throw new Error('Do not combine --all with --model or --model-key.');
  }

  if (options.all && options.employee) {
    throw new Error('Do not combine --all with --employee. Use --employee for a single employee-specific test.');
  }

  const config = await loadTeamConfig(workspaceRoot);
  if (!config) {
    throw new Error('No LLM configured. Run ait init first.');
  }

  const env = await loadEnvFile(workspaceRoot);

  if (options.all) {
    await testAllConfiguredModels(config, env, options.provider);
    console.log('✓ All connection tests passed');
    return;
  }

  let effective;
  try {
    const explicitProfile = {
      provider: options.provider,
      modelKey: options.modelKey,
      model: options.model,
    };

    if (options.employee) {
      const employeeManager = new AgentManager(workspaceRoot);
      await employeeManager.initialize();

      const matches = employeeManager.resolveAgent(options.employee);
      if (matches.length === 0) {
        const allEmployees = employeeManager.getAllAgents();
        const available = allEmployees
          .map(employee => `${employee.name} (${employee.role}) [${employee.id}]`)
          .join(', ');
        throw new Error(
          available.length > 0
            ? `No employee found matching "${options.employee}". Available employees: ${available}`
            : `No employee found matching "${options.employee}".`,
        );
      }

      if (matches.length > 1) {
        const choices = matches
          .map(match => `${match.name} (${match.role}) [${match.id}]`)
          .join(', ');
        throw new Error(`Multiple employees match "${options.employee}": ${choices}. Please be more specific.`);
      }

      const employee = matches[0];

      let skill;
      try {
        skill = await loadSkill(employee.skillPath);
      } catch {
        skill = undefined;
      }

      const mergedEmployeeProfile = {
        ...(employee.llm || {}),
        ...Object.fromEntries(
          Object.entries(explicitProfile).filter(([, value]) => value !== undefined),
        ),
      };

      effective = resolveEffectiveLlmSettings(config, { llm: mergedEmployeeProfile }, skill);
    } else {
      effective = resolveEffectiveLlmSettings(
        config,
        {
          llm: explicitProfile,
        },
      );
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'No effective LLM configuration found.');
  }

  const apiKeyName = effective.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
  const apiKey = env[apiKeyName] || env['AI_TEAM_LLM_API_KEY'] || env['LLM_API_KEY'] || env['OPENAI_API_KEY'];

  try {
    await testLlmConnection(effective.config, apiKey);
    console.log('✓ Connection successful');
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const providerBaseUrl = effective.config.provider === 'openai-compatible'
      ? effective.config.baseUrl
      : undefined;
    const modelToTest = effective.config.model;
    const attemptDetails = formatAttemptDetails(effective, options, Boolean(apiKey));
    if (providerBaseUrl && modelToTest) {
      const diagnostic = await diagnoseOpenAICompatibleFailure(providerBaseUrl, modelToTest, apiKey);
      if (diagnostic) {
        throw new Error(buildFailureMessage(baseMessage, attemptDetails, diagnostic, effective.config.provider));
      }
    }

    throw new Error(buildFailureMessage(baseMessage, attemptDetails, undefined, effective.config.provider));
  }
}

function formatAttemptDetails(
  effective: ResolvedLlmSettings,
  options: TestConnectionOptions,
  hasApiKey: boolean,
): string[] {
  const lines = [
    `providerRef=${effective.providerRef}`,
    `providerKind=${effective.config.provider}`,
    `model=${effective.config.model}`,
  ];

  if (options.modelKey) {
    lines.push(`modelKey=${options.modelKey}`);
  }
  if (options.employee) {
    lines.push(`employee=${options.employee}`);
  }
  if (effective.config.provider === 'openai-compatible') {
    lines.push(`baseUrl=${effective.config.baseUrl || '(missing)'}`);
    lines.push(`apiKeyPresent=${hasApiKey}`);
  }

  return lines;
}

function buildFailureMessage(
  baseMessage: string,
  attemptDetails: string[],
  diagnostic: string | undefined,
  providerKind: string,
): string {
  const lines = [baseMessage, `Attempt: ${attemptDetails.join(', ')}`];
  if (diagnostic) {
    lines.push(`Provider diagnostics: ${diagnostic}`);
  }

  const normalized = `${baseMessage}\n${diagnostic || ''}`.toLowerCase();
  if (providerKind === 'openai-compatible' && normalized.includes('all connection attempts failed')) {
    lines.push('Hint: The gateway is reachable, but it cannot connect to the backing model container.');
    lines.push('Hint: Try a different model key with `ait test-connection --provider <ref> --model-key <key>`.');
  }

  if (providerKind === 'openai-compatible' && normalized.includes('401')) {
    lines.push('Hint: Check your API key in .ai-team/.env and provider apiKeyEnvVar mapping.');
  }

  if (normalized.includes('429') || normalized.includes('quota')) {
    lines.push('Hint: Provider quota/rate limit reached. Retry later or switch provider/model.');
  }

  return lines.join('\n');
}

async function testAllConfiguredModels(
  config: NonNullable<Awaited<ReturnType<typeof loadTeamConfig>>>,
  env: Record<string, string>,
  providerFilter?: string,
): Promise<void> {
  const registry = config.providers || config.llmProviders;
  if (!registry || Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  const providerEntries = providerFilter
    ? [[providerFilter, registry[providerFilter]] as const]
    : Object.entries(registry);

  if (providerFilter && !registry[providerFilter]) {
    throw new Error(`Unknown provider '${providerFilter}'. Available: ${Object.keys(registry).join(', ')}`);
  }

  const allTargets: { providerRef: string; modelKey: string; modelId: string }[] = [];
  for (const [providerRef, providerConfig] of providerEntries) {
    if (!providerConfig) continue;
    const modelMap = providerConfig.models || {};
    for (const [modelKey, modelId] of Object.entries(modelMap)) {
      allTargets.push({ providerRef, modelKey, modelId });
    }
  }

  if (allTargets.length === 0) {
    throw new Error('No models found in provider dictionaries. Run `ait provider models refresh` first.');
  }

  let passed = 0;
  let failed = 0;
  const failureDetails: string[] = [];

  for (const target of allTargets) {
    let effective;
    try {
      effective = resolveEffectiveLlmSettings(
        config,
        {
          llm: {
            provider: target.providerRef,
            modelKey: target.modelKey,
          },
        },
      );
    } catch (error) {
      failed += 1;
      failureDetails.push(`${target.providerRef}/${target.modelKey}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const apiKeyName = effective.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey = env[apiKeyName] || env['AI_TEAM_LLM_API_KEY'] || env['LLM_API_KEY'] || env['OPENAI_API_KEY'];

    try {
      await testLlmConnection(effective.config, apiKey);
      passed += 1;
    } catch (error) {
      failed += 1;
      const parts: string[] = [
        `${target.providerRef}/${target.modelKey} (${target.modelId}): ${error instanceof Error ? error.message : String(error)}`,
      ];
      const providerBaseUrl = effective.config.provider === 'openai-compatible'
        ? effective.config.baseUrl
        : undefined;
      if (providerBaseUrl) {
        const diagnostic = await diagnoseOpenAICompatibleFailure(providerBaseUrl, target.modelId, apiKey);
        if (diagnostic) {
          parts.push(`diagnostic: ${diagnostic}`);
        }
      }
      failureDetails.push(parts.join(' | '));
    }
  }

  if (failed > 0) {
    throw new Error(`Tested ${allTargets.length} configured model(s): ${passed} passed, ${failed} failed. ${failureDetails.join('; ')}`);
  }
}

async function diagnoseOpenAICompatibleFailure(
  baseUrl: string,
  model: string,
  apiKey?: string,
): Promise<string | undefined> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const payload = {
    model,
    messages: [
      { role: 'user', content: 'Reply with exactly OK.' },
    ],
    max_tokens: 8,
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return undefined;
    }

    const bodyText = await response.text();
    const trimmed = bodyText.trim();
    if (!trimmed) {
      return `HTTP ${response.status}: provider returned no error body.`;
    }

    try {
      const parsed = JSON.parse(trimmed) as { detail?: unknown; error?: { message?: string } };
      if (typeof parsed.detail === 'string') {
        return parsed.detail;
      }
      if (parsed.error?.message) {
        return parsed.error.message;
      }
    } catch {
      return trimmed;
    }

    return trimmed;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

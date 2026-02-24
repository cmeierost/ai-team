/**
 * Test-connection command - verify LLM connectivity
 */

import chalk from 'chalk';
import ora from 'ora';
import {
  AgentManager,
  loadSkill,
  loadTeamConfig,
  loadEnvFile,
  testLlmConnection,
  resolveEffectiveLlmSettings,
} from '@ai-team/core';

interface TestConnectionOptions {
  provider?: string;
  modelKey?: string;
  model?: string;
  all?: boolean;
  employee?: string;
}

export async function testConnectionCommand(options: TestConnectionOptions = {}) {
  if (options.model && options.modelKey) {
    console.log(chalk.red('Use either --model or --model-key, not both.'));
    process.exit(1);
  }

  if (options.all && (options.model || options.modelKey)) {
    console.log(chalk.red('Do not combine --all with --model or --model-key.'));
    process.exit(1);
  }

  if (options.all && options.employee) {
    console.log(chalk.red('Do not combine --all with --employee. Use --employee for a single employee-specific test.'));
    process.exit(1);
  }

  const workspaceRoot = process.cwd();

  const config = await loadTeamConfig(workspaceRoot);
  if (!config) {
    console.log(chalk.red('No LLM configured. Run ') + chalk.bold('ait init') + chalk.red(' first.'));
    process.exit(1);
  }

  const env = await loadEnvFile(workspaceRoot);

  if (options.all) {
    await testAllConfiguredModels(config, env, options.provider);
    return;
  }

  let effective;
  let selectedEmployeeName: string | undefined;
  try {
    const explicitProfile = {
      provider: options.provider,
      modelKey: options.modelKey,
      model: options.model,
    };

    if (options.employee) {
      const agentManager = new AgentManager(workspaceRoot);
      await agentManager.initialize();

      const matches = agentManager.resolveAgent(options.employee);
      if (matches.length === 0) {
        console.log(chalk.red(`No employee found matching "${options.employee}".`));
        const allAgents = agentManager.getAllAgents();
        if (allAgents.length > 0) {
          console.log(chalk.dim('\nAvailable employees:'));
          for (const agent of allAgents) {
            console.log(chalk.dim(`  - ${agent.name} (${agent.role}) [${agent.id}]`));
          }
        }
        process.exit(1);
      }

      if (matches.length > 1) {
        console.log(chalk.yellow(`Multiple employees match "${options.employee}":`));
        for (const match of matches) {
          console.log(chalk.dim(`  - ${match.name} (${match.role}) [${match.id}]`));
        }
        console.log(chalk.yellow('Please be more specific.'));
        process.exit(1);
      }

      const employee = matches[0];
      selectedEmployeeName = `${employee.name} (${employee.role})`;

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
    console.log(chalk.red(error instanceof Error ? error.message : 'No effective LLM configuration found.'));
    process.exit(1);
  }

  const apiKeyName = effective.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
  const apiKey = env[apiKeyName] || env['AI_TEAM_LLM_API_KEY'] || env['LLM_API_KEY'] || env['OPENAI_API_KEY'];

  const spinner = ora('Testing LLM connection...').start();

  try {
    const reply = await testLlmConnection(effective.config, apiKey);
    spinner.succeed(chalk.green('LLM connection working!'));
    if (selectedEmployeeName) {
      console.log(chalk.dim('  Employee: ') + selectedEmployeeName);
    }
    if (effective.providerRef) {
      console.log(chalk.dim('  Provider Ref: ') + effective.providerRef);
    }
    console.log(chalk.dim('  Provider: ') + effective.config.provider);
    console.log(chalk.dim('  Model:    ') + (effective.config.model || '(default)'));
    if (options.modelKey) {
      console.log(chalk.dim('  Model Key: ') + options.modelKey);
    }
    console.log(chalk.dim('  Response: ') + reply);
  } catch (error) {
    spinner.fail(chalk.red('LLM connection failed'));
    if (error instanceof Error) {
      console.error(chalk.dim(error.message));
    }

    const providerBaseUrl = effective.config.provider === 'openai-compatible'
      ? effective.config.baseUrl
      : undefined;
    const modelToTest = effective.config.model;
    if (providerBaseUrl && modelToTest) {
      const diagnostic = await diagnoseOpenAICompatibleFailure(providerBaseUrl, modelToTest, apiKey);
      if (diagnostic) {
        console.error(chalk.yellow('\nProvider diagnostics:'));
        console.error(chalk.dim(diagnostic));
      }
    }

    process.exit(1);
  }
}

async function testAllConfiguredModels(
  config: NonNullable<Awaited<ReturnType<typeof loadTeamConfig>>>,
  env: Record<string, string>,
  providerFilter?: string,
): Promise<void> {
  const registry = config.providers || config.llmProviders;
  if (!registry || Object.keys(registry).length === 0) {
    console.log(chalk.red('No providers dictionary found in config. Run ') + chalk.bold('ait provider set') + chalk.red(' first.'));
    process.exit(1);
  }

  const providerEntries = providerFilter
    ? [[providerFilter, registry[providerFilter]] as const]
    : Object.entries(registry);

  if (providerFilter && !registry[providerFilter]) {
    console.log(chalk.red(`Unknown provider '${providerFilter}'. Available: ${Object.keys(registry).join(', ')}`));
    process.exit(1);
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
    console.log(chalk.yellow('No models found in provider dictionaries.'));
    console.log(chalk.dim('Run `ait provider models refresh` first.'));
    process.exit(1);
  }

  console.log(chalk.bold(`Testing ${allTargets.length} configured model(s)...\n`));

  let passed = 0;
  let failed = 0;

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
      console.log(chalk.red(`✖ ${target.providerRef}/${target.modelKey}`));
      console.log(chalk.dim(`  ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }

    const apiKeyName = effective.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey = env[apiKeyName] || env['AI_TEAM_LLM_API_KEY'] || env['LLM_API_KEY'] || env['OPENAI_API_KEY'];

    try {
      await testLlmConnection(effective.config, apiKey);
      passed += 1;
      console.log(chalk.green(`✔ ${target.providerRef}/${target.modelKey}`) + chalk.dim(` (${target.modelId})`));
    } catch (error) {
      failed += 1;
      console.log(chalk.red(`✖ ${target.providerRef}/${target.modelKey}`) + chalk.dim(` (${target.modelId})`));
      if (error instanceof Error) {
        console.log(chalk.dim(`  ${error.message}`));
      }
      const providerBaseUrl = effective.config.provider === 'openai-compatible'
        ? effective.config.baseUrl
        : undefined;
      if (providerBaseUrl) {
        const diagnostic = await diagnoseOpenAICompatibleFailure(providerBaseUrl, target.modelId, apiKey);
        if (diagnostic) {
          console.log(chalk.dim(`  ${diagnostic}`));
        }
      }
    }
  }

  console.log('');
  console.log(chalk.bold('Summary:') + ` ${chalk.green(`${passed} passed`)}, ${failed > 0 ? chalk.red(`${failed} failed`) : chalk.green('0 failed')}`);

  if (failed > 0) {
    process.exit(1);
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
      // Fall through and return raw body
    }

    return trimmed;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

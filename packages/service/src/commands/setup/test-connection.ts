import type {
  TeamConfig,
  ResolvedLlmSettings,
  IAgentManager,
  ILlmProviderTester,
  ITextToolCallParser,
} from '@ai-team/core';
import { resolveEffectiveLlmSettings } from '@ai-team/core';
import { TestConnectionOptions } from '@ai-team/api-contracts';

export interface TestConnectionCommandParams {
  workspaceRoot: string;
  options?: TestConnectionOptions;
}

export class TestConnectionCommand {
  constructor(
    private readonly teamConfig: TeamConfig,
    private readonly agentManager: IAgentManager,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly textToolCallParser: ITextToolCallParser
  ) {}

  async execute(params: TestConnectionCommandParams): Promise<void> {
    return testConnectionCommandAsync(
      params.options ?? {},
      this.teamConfig,
      this.agentManager,
      this.llmProviderTester,
      this.textToolCallParser
    );
  }

  async executeAsync(workspaceRoot: string, options: TestConnectionOptions = {}): Promise<void> {
    return this.execute({ workspaceRoot, options });
  }
}

async function testConnectionCommandAsync(
  options: TestConnectionOptions = {},
  teamConfig: TeamConfig,
  agentManager: IAgentManager,
  llmProviderTester: ILlmProviderTester,
  textToolCallParser: ITextToolCallParser
): Promise<void> {
  if (options.model && options.modelKey) {
    throw new Error('Use either --model or --model-key, not both.');
  }

  if (options.all && (options.model || options.modelKey)) {
    throw new Error('Do not combine --all with --model or --model-key.');
  }

  if (options.all && options.employee) {
    throw new Error(
      'Do not combine --all with --employee. Use --employee for a single employee-specific test.'
    );
  }

  if (options.all && options.toolCall) {
    throw new Error('Do not combine --all with --tool-call.');
  }

  const config = teamConfig;

  if (options.all) {
    await testAllConfiguredModels(config, llmProviderTester, options.provider);
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
      const matches = await agentManager.resolveAgentAsync(options.employee);
      if (matches.length === 0) {
        const allEmployees = await agentManager.getAllAgentsAsync();
        const available = allEmployees
          .map(
            (employee: { name: string; role: string; id: string }) =>
              `${employee.name} (${employee.role}) [${employee.id}]`
          )
          .join(', ');
        throw new Error(
          available.length > 0
            ? `No employee found matching "${options.employee}". Available employees: ${available}`
            : `No employee found matching "${options.employee}".`
        );
      }

      if (matches.length > 1) {
        const choices = matches
          .map(
            (match: { name: string; role: string; id: string }) =>
              `${match.name} (${match.role}) [${match.id}]`
          )
          .join(', ');
        throw new Error(
          `Multiple employees match "${options.employee}": ${choices}. Please be more specific.`
        );
      }

      const employee = matches[0];

      const mergedEmployeeProfile = {
        ...(employee.llm || {}),
        ...Object.fromEntries(
          Object.entries(explicitProfile).filter(([, value]) => value !== undefined)
        ),
      };

      effective = resolveEffectiveLlmSettings(config, { llm: mergedEmployeeProfile });
    } else {
      effective = resolveEffectiveLlmSettings(config, {
        llm: explicitProfile,
      });
    }
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'No effective LLM configuration found.'
    );
  }

  const apiKey = effective.config.apiKey;

  try {
    await llmProviderTester.testLlmConnectionAsync(effective.config, apiKey);
    console.log('✓ Connection successful');

    if (options.toolCall) {
      await testToolCallBehavior(effective, apiKey, textToolCallParser);
      console.log('✓ Tool-call behavior is compatible');
    }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const providerBaseUrl =
      effective.config.provider === 'openai-compatible' ? effective.config.baseUrl : undefined;
    const modelToTest = effective.config.model;
    const attemptDetails = formatAttemptDetails(effective, options, Boolean(apiKey));
    if (providerBaseUrl && modelToTest) {
      const diagnostic = await diagnoseOpenAICompatibleFailure(
        providerBaseUrl,
        modelToTest,
        apiKey
      );
      if (diagnostic) {
        throw new Error(
          buildFailureMessage(baseMessage, attemptDetails, diagnostic, effective.config.provider)
        );
      }
    }

    throw new Error(
      buildFailureMessage(baseMessage, attemptDetails, undefined, effective.config.provider)
    );
  }
}

async function testToolCallBehavior(
  effective: ResolvedLlmSettings,
  apiKey: string | undefined,
  textToolCallParser: ITextToolCallParser
): Promise<void> {
  const baseUrl = requireToolProbeBaseUrl(effective);
  const model = requireToolProbeModel(effective);
  const probeToolName = '__ait_ping_tool';
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await sendToolCallProbeRequest(endpoint, model, probeToolName, apiKey);
  const json = await readToolCallProbeJson(response);
  const message = json.choices?.[0]?.message;

  if (
    hasRecognizableToolCall(
      message,
      probeToolName,
      textToolCallParser.parseTextToolCalls.bind(textToolCallParser)
    )
  ) {
    return;
  }

  const textContent = typeof message?.content === 'string' ? message.content : '';
  const preview = textContent.trim().slice(0, 400);
  throw new Error(buildMissingToolCallMessage(probeToolName, preview));
}

function requireToolProbeBaseUrl(effective: ResolvedLlmSettings): string {
  if (effective.config.provider !== 'openai-compatible' || !effective.config.baseUrl) {
    throw new Error('Tool-call probe currently supports openai-compatible providers only.');
  }
  return effective.config.baseUrl;
}

function requireToolProbeModel(effective: ResolvedLlmSettings): string {
  if (!effective.config.model) {
    throw new Error('Tool-call probe requires a concrete model ID.');
  }
  return effective.config.model;
}

function buildToolCallProbePayload(model: string, probeToolName: string) {
  return {
    model,
    messages: [
      {
        role: 'user',
        content:
          'Call the __ait_ping_tool function exactly once with argument {"text":"ok"}. Do not answer with prose.',
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: probeToolName,
          description: 'Echo tool used only for probing model tool-call behavior.',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
            },
            required: ['text'],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: 'auto',
    temperature: 0,
    max_tokens: 96,
  };
}

function buildToolCallProbeHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function sendToolCallProbeRequest(
  endpoint: string,
  model: string,
  probeToolName: string,
  apiKey?: string
): Promise<Response> {
  const payload = buildToolCallProbePayload(model, probeToolName);
  const headers = buildToolCallProbeHeaders(apiKey);

  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(
      `Tool-call probe request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function readToolCallProbeJson(response: Response): Promise<{
  choices?: Array<{
    message?: {
      tool_calls?: Array<{ function?: { name?: string } }>;
      function_call?: { name?: string };
      content?: unknown;
    };
  }>;
}> {
  if (response.ok) {
    return (await response.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{ function?: { name?: string } }>;
          function_call?: { name?: string };
          content?: unknown;
        };
      }>;
    };
  }

  const bodyText = await response.text();
  const suffix = bodyText ? `: ${bodyText}` : '';
  throw new Error(`Tool-call probe failed with HTTP ${response.status}${suffix}`);
}

function hasRecognizableToolCall(
  message:
    | {
        tool_calls?: Array<{ function?: { name?: string } }>;
        function_call?: { name?: string };
        content?: unknown;
      }
    | undefined,
  probeToolName: string,
  parseTextToolCallsFn: (text: string, tools: Set<string>) => unknown[]
): boolean {
  const structuredToolCalls = message?.tool_calls;
  if (
    Array.isArray(structuredToolCalls) &&
    structuredToolCalls.some((call) => call?.function?.name?.trim() === probeToolName)
  ) {
    return true;
  }

  if (message?.function_call?.name?.trim() === probeToolName) {
    return true;
  }

  const textContent = typeof message?.content === 'string' ? message.content : '';
  const textCalls = parseTextToolCallsFn(textContent, new Set([probeToolName]));
  return textCalls.length > 0;
}

function buildMissingToolCallMessage(probeToolName: string, preview: string): string {
  const base = `Tool-call probe did not find a recognizable tool call for '${probeToolName}'.`;
  if (!preview) {
    return base;
  }
  return `${base} Response preview: ${preview}`;
}

function formatAttemptDetails(
  effective: ResolvedLlmSettings,
  options: TestConnectionOptions,
  hasApiKey: boolean
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
  providerKind: string
): string {
  const lines = [baseMessage, `Attempt: ${attemptDetails.join(', ')}`];
  if (diagnostic) {
    lines.push(`Provider diagnostics: ${diagnostic}`);
  }

  const normalized = `${baseMessage}\n${diagnostic || ''}`.toLowerCase();
  if (
    providerKind === 'openai-compatible' &&
    normalized.includes('all connection attempts failed')
  ) {
    lines.push(
      'Hint: The gateway is reachable, but it cannot connect to the backing model container.'
    );
    lines.push(
      'Hint: Try a different model key with `ait test-connection --provider <ref> --model-key <key>`.'
    );
  }

  if (providerKind === 'openai-compatible' && normalized.includes('401')) {
    lines.push('Hint: Check your API key in .ai-team/.env.');
  }

  if (normalized.includes('429') || normalized.includes('quota')) {
    lines.push('Hint: Provider quota/rate limit reached. Retry later or switch provider/model.');
  }

  return lines.join('\n');
}

async function testAllConfiguredModels(
  config: TeamConfig,
  llmProviderTester: ILlmProviderTester,
  providerFilter?: string
): Promise<void> {
  const registry = config.providers;
  if (!registry || Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  const providerEntries = providerFilter
    ? [[providerFilter, registry[providerFilter]] as const]
    : Object.entries(registry);

  if (providerFilter && !registry[providerFilter]) {
    throw new Error(
      `Unknown provider '${providerFilter}'. Available: ${Object.keys(registry).join(', ')}`
    );
  }

  const allTargets: { providerRef: string; modelKey: string; modelId: string }[] = [];
  for (const [providerRef, providerConfig] of providerEntries) {
    if (!providerConfig) continue;
    const models = providerConfig.models || [];
    for (const model of models) {
      allTargets.push({ providerRef, modelKey: model.name, modelId: model.name });
    }
  }

  if (allTargets.length === 0) {
    throw new Error('No models found in provider lists. Run `ait provider models refresh` first.');
  }

  let passed = 0;
  let failed = 0;
  const failureDetails: string[] = [];

  for (const target of allTargets) {
    let effective;
    try {
      effective = resolveEffectiveLlmSettings(config, {
        llm: {
          provider: target.providerRef,
          modelKey: target.modelKey,
        },
      });
    } catch (error) {
      failed += 1;
      failureDetails.push(
        `${target.providerRef}/${target.modelKey}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    const apiKey = effective.config.apiKey;

    try {
      await llmProviderTester.testLlmConnectionAsync(effective.config, apiKey);
      passed += 1;
    } catch (error) {
      failed += 1;
      const parts: string[] = [
        `${target.providerRef}/${target.modelKey} (${target.modelId}): ${error instanceof Error ? error.message : String(error)}`,
      ];
      const providerBaseUrl =
        effective.config.provider === 'openai-compatible' ? effective.config.baseUrl : undefined;
      if (providerBaseUrl) {
        const diagnostic = await diagnoseOpenAICompatibleFailure(
          providerBaseUrl,
          target.modelId,
          apiKey
        );
        if (diagnostic) {
          parts.push(`diagnostic: ${diagnostic}`);
        }
      }
      failureDetails.push(parts.join(' | '));
    }
  }

  if (failed > 0) {
    throw new Error(
      `Tested ${allTargets.length} configured model(s): ${passed} passed, ${failed} failed. ${failureDetails.join('; ')}`
    );
  }
}

async function diagnoseOpenAICompatibleFailure(
  baseUrl: string,
  model: string,
  apiKey?: string
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
    messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
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

/**
 * Chat command - chat with an agent using the configured LLM
 * Supports live agent switching when user asks to be forwarded.
 * Supports explicit slash commands and direct tool calls.
 */

import chalk from 'chalk';
import { exec } from 'child_process';
import { input, select, confirm } from '@inquirer/prompts';
import ora from 'ora';
import fs from 'fs/promises';
import { promisify } from 'util';
import {
  AgentManager,
  ChatManager,
  ChatMessage,
  Agent,
  ContextLevel,
  LlmService,
  RoleType,
  SkillManager,
  loadSkill,
  loadTeamConfig,
  ALL_TOOLS,
  getAgentTools,
  executeAgentTool,
} from '@ai-team/core';
import type { ChatCompletionMessageParam, LlmChatOptions } from '@ai-team/core';
import { listCommand } from './list.js';
import { hireCommand } from './hire.js';
import { infoCommand } from './info.js';
import { fireCommand } from './fire.js';
import { createCommand } from './create.js';
import { initCommand } from './init.js';
import { hhRefreshCommand } from './hh.js';
import { testConnectionCommand } from './test-connection.js';
import { ensureUserEnvVars } from '../utils/user-env.js';
import { getGitUserName } from '../utils/git.js';

const execAsync = promisify(exec);

interface ChatOptions {
  message?: string;
  context?: string[];
  oneShot?: boolean;
}

interface SendResult {
  switchedTo?: Agent;
  handoffMessage?: string;
}

interface HandoffMeta {
  fromAgentId: string;
  note: string;
}

export async function chatCommand(agentId: string, options: ChatOptions) {
  try {
    const workspaceRoot = process.cwd();
    const agentManager = new AgentManager(workspaceRoot);
    const chatManager = new ChatManager(workspaceRoot);
    const handoffTracker = new Map<string, HandoffMeta>();

    const teamConfig = await loadTeamConfig(workspaceRoot);
    const registry = teamConfig?.providers || teamConfig?.llmProviders;
    const defaultProviderRef = registry
      ? (Object.entries(registry).find(([, cfg]) => cfg.isDefault)?.[0]
        || teamConfig?.defaultLlmProvider
        || Object.keys(registry)[0])
      : undefined;
    const defaultProviderKind = defaultProviderRef ? registry?.[defaultProviderRef]?.kind : undefined;
    const requiresApiKey = defaultProviderKind
      ? defaultProviderKind === 'openai-compatible'
      : teamConfig?.llm?.provider === 'openai-compatible';
    const env = await ensureUserEnvVars(
      workspaceRoot,
      { developerName: true, apiKey: requiresApiKey },
      { quiet: true },
    );
    const developerName = resolveDeveloperName(env) ?? getGitUserName();

    await agentManager.initialize();

    // Fuzzy resolve: match by ID, role, or name
    const matches = agentManager.resolveAgent(agentId);
    let agent: Agent | undefined;

    if (matches.length === 0) {
      console.error(chalk.red(`Agent not found: "${agentId}"`));
      const all = agentManager.getAllAgents();
      if (all.length > 0) {
        console.log(chalk.dim('\nAvailable agents:'));
        for (const a of all) {
          console.log(chalk.dim(`  - ${a.name} (${a.role}) [id: ${a.id}]`));
        }
      }
      console.log('\nRun ' + chalk.cyan('ait list') + ' to see all agents.');
      process.exit(1);
    } else if (matches.length === 1) {
      agent = matches[0];
    } else {
      // Multiple matches — let the user pick
      const chosen = await select({
        message: `Multiple agents match "${agentId}". Which one?`,
        choices: matches.map(a => ({
          name: `${a.name} — ${a.role} [${a.id}]`,
          value: a.id,
        })),
      });
      agent = agentManager.getAgent(chosen);
    }

    if (!agent) {
      console.error(chalk.red('Could not resolve agent.'));
      process.exit(1);
    }

    // Initialize LLM service
    const llm = new LlmService(workspaceRoot);
    const spinner = ora('Connecting to LLM...').start();
    try {
      await llm.initialize();
      spinner.succeed(
        `Connected to ${chalk.cyan(llm.provider)} using ${chalk.cyan(llm.modelName)}`
      );
    } catch (error) {
      spinner.fail('Failed to initialize LLM');
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      console.log(chalk.dim('Run "ait init" to configure an LLM provider.'));
      process.exit(1);
    }

    // Load skill instructions for the agent's role
    let skill;
    try {
      skill = await loadSkill(agent.skillPath);
    } catch {
      // Skill file may not exist — that's fine, agent bio is still used
    }

    console.log(chalk.bold(`\nChat with ${chalk.cyan(agent.name)} ${chalk.dim(`(${agent.role})`)}`));
    console.log(chalk.dim('Type "exit" to end the conversation'));
    console.log(chalk.dim('Type "/help" to see available in-chat commands'));
    console.log(chalk.dim('Ask to be forwarded or type "/chat <name>" to switch agents'));
    console.log(chalk.dim('Use "#tool_name {json}" or "/tool tool_name {json}" for direct tool calls\n'));

    // Load chat history
    let history = await chatManager.loadChatHistory(agent.id);
    if (history.length > 0) {
      console.log(chalk.dim(`(${history.length} previous messages loaded)\n`));
    }

    // Agent greets the user on first contact
    if (history.length === 0) {
      await greetUser(llm, chatManager, agentManager, agent, history, skill, developerName);
    }

    // Single message mode
    if (options.message) {
      const result = await sendMessage(
        llm,
        chatManager,
        agentManager,
        agent,
        history,
        options.message,
        skill,
        options.context,
        handoffTracker,
        developerName,
      );
      if (result.switchedTo) {
        const fromAgent = agent;
        agent = result.switchedTo;
        try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
        history = await chatManager.loadChatHistory(agent.id);
        if (result.handoffMessage) {
          const handoffMessage: ChatMessage = {
            timestamp: new Date().toISOString(),
            from: fromAgent.id,
            content: result.handoffMessage,
          };
          await chatManager.appendMessage(agent.id, handoffMessage);
          history.push(handoffMessage);
          console.log(chalk.dim('  Handoff note ') + chalk.cyan(`${fromAgent.name} (${fromAgent.role}): `) + result.handoffMessage);
          console.log();
          handoffTracker.set(agent.id, {
            fromAgentId: fromAgent.id,
            note: result.handoffMessage,
          });
          await acknowledgeHandoff(
            llm,
            chatManager,
            agentManager,
            agent,
            history,
            skill,
            fromAgent,
            result.handoffMessage,
          );
        }
      }
      if (options.oneShot) {
        return;
      }
    }

    // Interactive chat loop — supports commands and live agent switching
    while (true) {
      const message = await input({
        message: formatUserPrompt(agent),
        validate: (val: string) => val.length > 0 || 'Message cannot be empty',
      });

      if (message.toLowerCase() === 'exit') {
        console.log(chalk.dim('Goodbye!'));
        break;
      }

      // ── In-chat command dispatch ──────────────────────────────────
      const trimmedMessage = message.trim();
      const cmd = parseInChatCommand(trimmedMessage);
      const looksLikeDirectTool = isDirectToolSyntax(trimmedMessage);
      if (trimmedMessage.startsWith('/') && !cmd && !looksLikeDirectTool) {
        console.log(chalk.yellow('Unknown slash command. Type /help to see available commands.'));
        console.log();
        continue;
      }

      if (cmd) {
        if (cmd.name === 'help') {
          printChatHelp();
          continue;
        }

        if (cmd.name === 'list') {
          await listCommand({});
          console.log();
          continue;
        }

        if (cmd.name === 'who') {
          printCurrentChatTarget(agent);
          console.log();
          continue;
        }

        if (cmd.name === 'hire') {
          await hireCommand({});
          // Reload agents after hire
          await agentManager.loadAllAgents();
          console.log();
          continue;
        }

        if (cmd.name === 'info') {
          await infoCommand(cmd.args || agent.id, {});
          console.log();
          continue;
        }

        if (cmd.name === 'fire') {
          if (!cmd.args) {
            console.log(chalk.yellow('Usage: fire <name|id|role>'));
            console.log();
            continue;
          }
          await fireCommand(cmd.args, {});
          await agentManager.loadAllAgents();
          const activeAgentId = agent?.id;
          if (activeAgentId && agentManager.getAllAgents().every(a => a.id !== activeAgentId)) {
            const fallback = agentManager.getAllAgents()[0];
            if (fallback) {
              agent = fallback;
              try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
              history = await chatManager.loadChatHistory(agent.id);
            }
          }
          console.log();
          continue;
        }

        if (cmd.name === 'create') {
          const type = (cmd.args || 'agent').split(/\s+/)[0];
          await createCommand(type, { interactive: true });
          await agentManager.loadAllAgents();
          console.log();
          continue;
        }

        if (cmd.name === 'hh') {
          const sub = (cmd.args || '').trim().toLowerCase();
          if (sub === 'refresh') {
            await hhRefreshCommand();
          } else {
            console.log(chalk.yellow('Usage: hh refresh'));
          }
          console.log();
          continue;
        }

        if (cmd.name === 'test-connection') {
          await testConnectionCommand();
          console.log();
          continue;
        }

        if (cmd.name === 'init') {
          await initCommand({});
          await agentManager.loadAllAgents();
          console.log();
          continue;
        }

        if (cmd.name === 'overview') {
          const overview = await getWorkspaceOverview(workspaceRoot);
          console.log(chalk.bold('\nWorkspace Overview\n'));
          console.log(chalk.dim(overview));
          await appendToolOutputToHistory(chatManager, history, agent.id, 'overview', overview);
          console.log(chalk.dim('  (Shared overview output with ') + chalk.cyan(agent.name) + chalk.dim(' for future context.)'));
          console.log();
          continue;
        }

        if (cmd.name === 'run' || cmd.name === 'shell') {
          if (!cmd.args) {
            console.log(chalk.yellow('Usage: run <command>'));
            console.log();
            continue;
          }
          await runShellCommand(cmd.args, workspaceRoot, chatManager, history, agent);
          console.log();
          continue;
        }

        if (cmd.name === 'chat' && cmd.args) {
          const parsed = parseChatSwitchArgs(cmd.args);
          const target = await resolveSwitch(parsed.targetQuery, agentManager, agent.id);
          if (target) {
            const fromAgent = agent;
            agent = target;
            try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
            history = await chatManager.loadChatHistory(agent.id);

            if (parsed.handoffMessage) {
              await appendHandoffNote(chatManager, history, agent.id, fromAgent, parsed.handoffMessage);
              handoffTracker.set(agent.id, {
                fromAgentId: fromAgent.id,
                note: parsed.handoffMessage,
              });
            }

            console.log(chalk.yellow(`\n↪ Switched to ${agent.name} (${agent.role})\n`));
            if (history.length > 0) {
              console.log(chalk.dim(`(${history.length} previous messages loaded)\n`));
            }

            if (parsed.handoffMessage) {
              console.log(
                chalk.dim('  Handoff note ') + chalk.cyan(`${fromAgent.name} (${fromAgent.role}): `) + parsed.handoffMessage
              );
              console.log();
              await acknowledgeHandoff(
                llm,
                chatManager,
                agentManager,
                agent,
                history,
                skill,
                fromAgent,
                parsed.handoffMessage,
              );
            }

            const shouldGreet = history.length === 0 && !parsed.handoffMessage;
            if (shouldGreet) {
              await greetUser(llm, chatManager, agentManager, agent, history, skill, developerName);
            }
          } else {
            console.log(chalk.red(`Agent not found: "${parsed.targetQuery}"`));
            const all = agentManager.getAllAgents();
            if (all.length > 0) {
              console.log(chalk.dim('Available agents:'));
              for (const a of all) {
                console.log(chalk.dim(`  - ${a.name} (${a.role}) [id: ${a.id}]`));
              }
            }
            console.log();
          }
          continue;
        }

        if (cmd.name === 'history') {
          printHistory(history, agent, cmd.args);
          continue;
        }

        if (cmd.name === 'portfolio' || cmd.name === 'bio') {
          await printPortfolio(agent);
          continue;
        }

        if (cmd.name === 'graph') {
          const { graphCommand } = await import('./graph.js');
          await graphCommand({ mode: 'hierarchy' });
          console.log();
          continue;
        }

        // Unknown command — fall through to LLM
      }

      // ── Natural language forward detection ────────────────────────
      const switchTarget = detectForwardRequest(message, agentManager, agent.id);
      if (switchTarget) {
        console.log(
          chalk.yellow(`\n↪ Switching from ${agent.name} (${agent.role}) to ${switchTarget.name} (${switchTarget.role})…\n`)
        );
        agent = switchTarget;
        try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
        history = await chatManager.loadChatHistory(agent.id);
        console.log(chalk.bold(`Chat with ${chalk.cyan(agent.name)} ${chalk.dim(`(${agent.role})`)}`));
        if (history.length > 0) {
          console.log(chalk.dim(`(${history.length} previous messages loaded)`));
        }
        console.log();
        // Send a greeting from the new agent
        const handoffResult = await sendMessage(
          llm,
          chatManager,
          agentManager,
          agent,
          history,
          `Hi, I was just forwarded to you from another team member. ${message}`,
          skill,
          options.context,
          handoffTracker,
          developerName,
        );

        if (handoffResult.switchedTo) {
          const fromAgent = agent;
          agent = handoffResult.switchedTo;
          try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
          history = await chatManager.loadChatHistory(agent.id);
          if (handoffResult.handoffMessage) {
            await appendHandoffNote(chatManager, history, agent.id, fromAgent, handoffResult.handoffMessage);
            console.log(chalk.dim('  Handoff note ') + chalk.cyan(`${fromAgent.name} (${fromAgent.role}): `) + handoffResult.handoffMessage);
            console.log();
            handoffTracker.set(agent.id, {
              fromAgentId: fromAgent.id,
              note: handoffResult.handoffMessage,
            });
            await acknowledgeHandoff(
              llm,
              chatManager,
              agentManager,
              agent,
              history,
              skill,
              fromAgent,
              handoffResult.handoffMessage,
            );
          }
          (sendMessage as any).identitySwitch = true;
          console.log(chalk.bold(`Chat with ${chalk.cyan(agent.name)} ${chalk.dim(`(${agent.role})`)}`));
          if (history.length > 0) {
            console.log(chalk.dim(`(${history.length} previous messages loaded)`));
          }
          console.log();
        }
        continue;
      }

      const requestedTarget = extractForwardTargetName(message);
      if (requestedTarget) {
        console.log(
          chalk.yellow(
            `I couldn't find "${requestedTarget}" in your team. Try ${chalk.cyan(`chat ${requestedTarget}`)} (fuzzy search), or hire them first.`
          )
        );
        console.log();
        continue;
      }

      const result = await sendMessage(
          llm,
          chatManager,
          agentManager,
          agent,
          history,
        message,
        skill,
        options.context,
        handoffTracker,
        developerName,
      );

      if (result.switchedTo) {
        const fromAgent = agent;
        agent = result.switchedTo;
        try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
        history = await chatManager.loadChatHistory(agent.id);
        if (result.handoffMessage) {
          await appendHandoffNote(chatManager, history, agent.id, fromAgent, result.handoffMessage);
          console.log(chalk.dim('  Handoff note ') + chalk.cyan(`${fromAgent.name} (${fromAgent.role}): `) + result.handoffMessage);
          console.log();
          handoffTracker.set(agent.id, {
            fromAgentId: fromAgent.id,
            note: result.handoffMessage,
          });
          await acknowledgeHandoff(
            llm,
            chatManager,
            agentManager,
            agent,
            history,
            skill,
            fromAgent,
            result.handoffMessage,
          );
        }
        (sendMessage as any).identitySwitch = true;
        console.log(chalk.bold(`Chat with ${chalk.cyan(agent.name)} ${chalk.dim(`(${agent.role})`)}`));
        if (history.length > 0) {
          console.log(chalk.dim(`(${history.length} previous messages loaded)`));
        }
        console.log();
      }
    }
  } catch (error) {
    console.error(chalk.red('Error in chat:'), error);
    process.exit(1);
  }
}

async function sendMessage(
  llm: LlmService,
  chatManager: ChatManager,
  agentManager: AgentManager,
  agent: Agent,
  history: ChatMessage[],
  message: string,
  skill?: import('@ai-team/core').Skill,
  contextFiles?: string[],
  handoffTracker?: Map<string, HandoffMeta>,
  developerName?: string,
): Promise<SendResult> {
  const slashCommand = parseInChatCommand(message.trim());
  if (slashCommand?.name === 'who') {
    printCurrentChatTarget(agent);
    return {};
  }

  const looksLikeDirectTool = isDirectToolSyntax(message);
  const directToolCall = parseDirectToolCall(message);
  if (directToolCall) {
    await executeDirectToolCall(
      directToolCall,
      chatManager,
      history,
      agent,
      agentManager.workspaceRoot,
      contextFiles,
    );
    return {};
  }

  if (looksLikeDirectTool) {
    return {};
  }

  const llmUpdateRequest = parseEmployeeLlmUpdateRequest(message);
  if (llmUpdateRequest) {
    const previewParts = [
      llmUpdateRequest.model ? `model=${llmUpdateRequest.model}` : undefined,
      llmUpdateRequest.modelKey ? `modelKey=${llmUpdateRequest.modelKey}` : undefined,
      llmUpdateRequest.provider ? `provider=${llmUpdateRequest.provider}` : undefined,
      llmUpdateRequest.temperature !== undefined ? `temperature=${llmUpdateRequest.temperature}` : undefined,
      llmUpdateRequest.maxTokens !== undefined ? `maxTokens=${llmUpdateRequest.maxTokens}` : undefined,
      llmUpdateRequest.topP !== undefined ? `topP=${llmUpdateRequest.topP}` : undefined,
      llmUpdateRequest.presencePenalty !== undefined ? `presencePenalty=${llmUpdateRequest.presencePenalty}` : undefined,
      llmUpdateRequest.frequencyPenalty !== undefined ? `frequencyPenalty=${llmUpdateRequest.frequencyPenalty}` : undefined,
    ].filter(Boolean).join(', ');

    const allowed = await confirm({
      message: `Allow ${agent.name} to update ${llmUpdateRequest.employee}'s LLM settings (${previewParts || 'profile update'})?`,
      default: false,
    });

    if (!allowed) {
      console.log(chalk.dim('LLM profile update canceled by user.'));
      return {};
    }

    const execution = await executeAgentTool(
      {
        toolName: 'update_employee_llm',
        params: llmUpdateRequest,
        context: {
          agent,
          workspaceRoot: agentManager.workspaceRoot,
          currentFiles: contextFiles,
        },
      },
      {
        onBeforeExecute: () => true,
      },
    );

    if (!execution.ok) {
      console.log(chalk.red(`Failed to update employee LLM profile: ${execution.error || 'Unknown error'}`));
      return {};
    }

    const payload = execution.result as { employee?: string; llm?: unknown };
    const target = payload.employee || llmUpdateRequest.employee;
    const responseText = `Updated LLM settings for ${target}.`;

    process.stdout.write(chalk.cyan(`\n${agent.name}`) + chalk.dim(` (${agent.role})`) + chalk.cyan(': '));
    process.stdout.write(responseText + '\n\n');

    const agentMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agent.id,
      content: responseText,
    };
    await chatManager.appendMessage(agent.id, agentMessage);
    history.push(agentMessage);
    await appendToolOutputToHistory(
      chatManager,
      history,
      agent.id,
      'update_employee_llm',
      stringifyToolPayload(payload.llm),
    );
    await agentManager.recordInteraction(agent.id);
    return {};
  }

  const cliGrantRequest = parseCliGrantRequest(message);
  if (cliGrantRequest) {
    const allowed = await confirm({
      message: `Allow ${agent.name} to grant '${cliGrantRequest.command}' to ${cliGrantRequest.employee}?`,
      default: false,
    });

    if (!allowed) {
      const denied = 'CLI tool grant canceled by user.';
      console.log(chalk.dim(denied));
      return {};
    }

    const execution = await executeAgentTool(
      {
        toolName: 'register_cli_tool',
        params: {
          command: cliGrantRequest.command,
          employee: cliGrantRequest.employee,
        },
        context: {
          agent,
          workspaceRoot: agentManager.workspaceRoot,
          currentFiles: contextFiles,
        },
      },
      {
        onBeforeExecute: () => true,
      },
    );

    if (!execution.ok) {
      console.log(chalk.red(`Failed to grant CLI tool: ${execution.error || 'Unknown error'}`));
      return {};
    }

    const payload = execution.result as { employee?: string; command?: string; cliTools?: string[] };
    const target = payload.employee || cliGrantRequest.employee;
    const command = payload.command || cliGrantRequest.command;
    const responseText = `Granted CLI tool '${command}' to ${target}. Allowed CLI tools now: ${(payload.cliTools || []).join(', ') || command}.`;

    process.stdout.write(chalk.cyan(`\n${agent.name}`) + chalk.dim(` (${agent.role})`) + chalk.cyan(': '));
    process.stdout.write(responseText + '\n\n');

    const agentMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agent.id,
      content: responseText,
    };
    await chatManager.appendMessage(agent.id, agentMessage);
    history.push(agentMessage);
    await appendToolOutputToHistory(
      chatManager,
      history,
      agent.id,
      'register_cli_tool',
      stringifyToolPayload(execution.result),
    );
    await agentManager.recordInteraction(agent.id);
    return {};
  }

  // Save user message
  const userMessage: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    content: message,
    context: contextFiles,
  };
  await chatManager.appendMessage(agent.id, userMessage);
  history.push(userMessage);

  // Build message array from history
  let messages: ChatCompletionMessageParam[] =
    LlmService.historyToMessages(history, agent.id);

  if (developerName) {
    if (!(sendMessage as any).developerIdentityInjected) {
      (sendMessage as any).developerIdentityInjected = new Set<string>();
    }
    const identityInjected = (sendMessage as any).developerIdentityInjected as Set<string>;
    if (!identityInjected.has(agent.id)) {
      messages.unshift({
        role: 'system',
        content:
          `You are speaking with ${developerName}, the human developer orchestrating this chat. `
          + 'Address them by name, do not confuse them with other agents, '
          + 'and treat any pasted notes as context they are sharing.',
      });
      identityInjected.add(agent.id);
    }
  }

  // If a system identity clarification is requested, inject it as a system message
  if ((sendMessage as any).identitySwitch) {
    messages.unshift({
      role: 'system',
      content: `You are now ${agent.name}, ${agent.role}. The previous agent has handed off this conversation to you. Respond only as ${agent.name}.`,
    });
    // Reset the flag for future calls
    (sendMessage as any).identitySwitch = false;
  }

  const overviewInjected = (sendMessage as any).overviewInjected as Set<string> | undefined;
  if (isArchitectLikeRole(agent.role) && !(overviewInjected?.has(agent.id))) {
    const workspaceOverview = await getWorkspaceOverview(agentManager.workspaceRoot);
    messages.unshift({
      role: 'system',
      content:
        'You are getting an initial workspace snapshot to orient on an existing codebase. '
        + 'Use it to ground your advice and planning. If more detail is needed, ask the user to run `overview` and focus on specific files.\n\n'
        + workspaceOverview,
    });
    if (!(sendMessage as any).overviewInjected) {
      (sendMessage as any).overviewInjected = new Set<string>();
    }
    ((sendMessage as any).overviewInjected as Set<string>).add(agent.id);
  }

  // Stream the response with team roster context
  const teamRoster = agentManager.getAllAgents();
  process.stdout.write(chalk.cyan(`\n${agent.name}`) + chalk.dim(` (${agent.role})`) + chalk.cyan(': '));

  let fullResponse = '';
  let llmOptions: LlmChatOptions | undefined;
  try {
    llmOptions = await configureLlmForAgent(agentManager.workspaceRoot, llm, agent, skill);

    const availableTools = getAgentTools(agent);
    const toolDefinitions = Object.values(availableTools).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: buildModelToolParameters(tool.parameters),
    }));

    const toolRequired = shouldRequireToolCall(userMessage.content);
    const messagesWithToolPolicy = toolDefinitions.length > 0
      ? [
        {
          role: 'system' as const,
          content:
            `Tool-calling is available for this turn. You may call only these tools: ${toolDefinitions.map(tool => tool.name).join(', ')}. `
            + 'Do not invent tool names. If a listed tool can retrieve required information, call it instead of asking the developer to run shell commands.'
            + (toolRequired
              ? ' For this request, you must call at least one listed tool before giving your final answer.'
              : ''),
        },
        ...messages,
      ]
      : messages;

    if (toolDefinitions.length === 0) {
      fullResponse = await llm.chat(agent, messages, llmOptions, skill, teamRoster);
    } else {
      try {
        const result = await llm.chatWithTools(
          agent,
          messagesWithToolPolicy,
          toolDefinitions,
          async (toolCall) => {
            const toolLabel = `${toolCall.toolName}(${formatToolArgs(toolCall.args)})`;
            const approved = await confirm({
              message: `Allow ${agent.name} to run tool ${toolLabel}?`,
              default: false,
            });

            const execution = await executeAgentTool(
              {
                toolName: toolCall.toolName,
                params: toolCall.args,
                context: {
                  agent,
                  workspaceRoot: agentManager.workspaceRoot,
                  currentFiles: contextFiles,
                },
              },
              {
                onBeforeExecute: () => approved,
              },
            );

            const outputText = execution.ok
              ? stringifyToolPayload(execution.result)
              : execution.error || 'Unknown tool execution error';
            await appendToolOutputToHistory(chatManager, history, agent.id, execution.toolName, outputText);

            return {
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              result: execution.ok ? execution.result : (execution.error || 'Tool execution failed'),
              isError: !execution.ok,
            };
          },
          llmOptions,
          skill,
          teamRoster,
        );

        fullResponse = result.text;
      } catch (toolError) {
        if (!shouldFallbackToPlainChat(toolError)) {
          throw toolError;
        }

        console.log(chalk.dim('\nTool-calling is not supported by this endpoint/model; retrying without tools...'));
        fullResponse = await llm.chat(agent, messagesWithToolPolicy, llmOptions, skill, teamRoster);
      }
    }

    process.stdout.write(fullResponse);
  } catch (error) {
    console.error(
      chalk.red('\nLLM unavailable:'),
      formatLlmError(error),
    );
    console.log(chalk.dim(`Attempted provider/model: ${formatLlmAttempt(llm, llmOptions)}`));
    console.log(chalk.dim('Try again when your LLM server is back online, or run ') + chalk.cyan('ait test-connection') + chalk.dim(' for diagnostics.'));
    return {};
  }

  process.stdout.write('\n\n');

  // Record interaction
  await agentManager.recordInteraction(agent.id);

  // Save agent response
  const agentMessage: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    content: fullResponse.trim(),
  };
  await chatManager.appendMessage(agent.id, agentMessage);
  history.push(agentMessage);

  const hireFromResponse = extractHireDirective(fullResponse, agent);
  if (hireFromResponse) {
    const lineage = handoffTracker?.get(agent.id);
    const managerAgent = lineage?.fromAgentId ? agentManager.getAgent(lineage.fromAgentId) : undefined;
    const created = await createAgentFromChat(
      agentManager,
      agent,
      hireFromResponse.name,
      hireFromResponse.role,
      managerAgent,
    );
    if (created) {
      console.log(
        chalk.green(
          `✓ ${agent.name} hired ${created.name} as ${created.role}. (${created.id})`
        )
      );
      await agentManager.loadAllAgents();
      const onboardingManager = managerAgent ?? agent;
      await seedNewHireContext(
        chatManager,
        created,
        onboardingManager,
        lineage?.note,
      );
    }
  }

  const handoff = detectResponseHandoffDirective(fullResponse, agentManager, agent.id);
  if (handoff?.target) {
    console.log(
      chalk.yellow(`\n↪ ${agent.name} (${agent.role}) handed off to ${handoff.target.name} (${handoff.target.role}).\n`)
    );
    const trimmedResponse = fullResponse.trim();
    const trimmedNote = handoff.message?.trim();
    const combinedNote = trimmedNote
      ? `${trimmedNote}\n\n---\nContext from ${agent.name}:\n${trimmedResponse}`
      : trimmedResponse;

    return {
      switchedTo: handoff.target,
      handoffMessage: combinedNote,
    };
  }

  const claimedHandoffName = extractClaimedHandoffName(fullResponse);
  if (claimedHandoffName) {
    console.log(
      chalk.yellow(
        `↪ ${agent.name} mentioned "${claimedHandoffName}", but no matching team member exists yet. Try ${chalk.cyan(`chat ${claimedHandoffName}`)} (fuzzy search), or run ${chalk.cyan('hire')} to create them first.\n`
      )
    );
  }

  return {};
}

function resolveDeveloperName(env: Record<string, string>): string | undefined {
  return env['AI_TEAM_USER_NAME']?.trim()
    || env['AI_TEAM_USER']?.trim()
    || env['AI_TEAM_DEVELOPER']?.trim();
}

// ============================================================================
// Agent greeting
// ============================================================================

/**
 * Have the agent introduce themselves and greet the user.
 * Only called on first contact (no history) or on agent switch.
 */
async function greetUser(
  llm: LlmService,
  chatManager: ChatManager,
  agentManager: AgentManager,
  agent: Agent,
  history: ChatMessage[],
  skill: import('@ai-team/core').Skill | undefined,
  developerName: string | undefined,
) {
  const nameRef = developerName ? `, ${developerName}` : '';
  const prompt = `The developer${nameRef} just opened a chat with you. `
    + 'Introduce yourself briefly: say hi, state your name and role, and ask what you can do for them. '
    + '1-2 sentences max. Be warm but concise.';

  // We inject this as a hidden system-level nudge, not a user message
  const messages: ChatCompletionMessageParam[] = [
    { role: 'user', content: prompt },
  ];

  const teamRoster = agentManager.getAllAgents();
  process.stdout.write(chalk.cyan(`\n${agent.name}`) + chalk.dim(` (${agent.role})`) + chalk.cyan(': '));

  let fullResponse = '';
  let llmOptions: LlmChatOptions | undefined;
  try {
    llmOptions = await configureLlmForAgent(agentManager.workspaceRoot, llm, agent, skill);
    const stream = await llm.streamChat(agent, messages, llmOptions, skill, teamRoster);
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        process.stdout.write(delta);
        fullResponse += delta;
      }
    }
  } catch (err) {
    console.error(chalk.red('\nLLM unavailable:'), formatLlmError(err));
    console.log(chalk.dim(`Attempted provider/model: ${formatLlmAttempt(llm, llmOptions)}`));
    console.log(chalk.dim('LLM greeting skipped. You can continue once the server is reachable.'));
    return;
  }

  process.stdout.write('\n\n');

  // Save the greeting to history so it persists
  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    content: fullResponse.trim(),
  };
  await chatManager.appendMessage(agent.id, agentMsg);
  history.push(agentMsg);
  await agentManager.recordInteraction(agent.id);
}

// ============================================================================
// Forward / switch detection
// ============================================================================

const FORWARD_PATTERNS = [
  /(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|over\s+to)\s+(.+)/i,
  /(?:let me|i(?:'d| would) like to)\s+(?:talk|speak|chat)\s+(?:to|with)\s+(.+)/i,
  /(?:can (?:you|i)|please)\s+(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|with)\s+(.+)/i,
  /(?:put me through|patch me through|hand me off)\s+(?:to)\s+(.+)/i,
  /(?:i (?:want|need) to (?:talk|speak|chat) (?:to|with))\s+(.+)/i,
];

const HANDOFF_PATTERNS = [
  /(?:you(?:'| a)?re now talking to|you are now talking to|you(?:'| a)?re talking to|you are talking to)\s+\**([^\n.,:;!]+)\**/i,
  /(?:this is)\s+\**([^\n.,:;!]+)\**/i,
];

/**
 * Detect if the user's message is asking to be forwarded to another agent.
 * Returns the resolved Agent if a match is found, or undefined otherwise.
 */
function detectForwardRequest(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
): Agent | undefined {
  const target = extractForwardTargetName(message);
  if (!target) return undefined;

  const matches = agentManager.resolveAgent(target);
  const filtered = matches.filter(a => a.id !== currentAgentId);
  if (filtered.length > 0) return filtered[0];

  return undefined;
}

function parseChatSwitchArgs(args: string): { targetQuery: string; handoffMessage?: string } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { targetQuery: '' };
  }

  // Supports: chat "linda tran" message..., chat linda message..., chat hr-director
  const quotedMatch = trimmed.match(/^"([^"]+)"\s*(.*)$/);
  if (quotedMatch) {
    const targetQuery = quotedMatch[1].trim();
    const handoffMessage = quotedMatch[2].trim();
    return {
      targetQuery,
      handoffMessage: handoffMessage.length > 0 ? handoffMessage : undefined,
    };
  }

  const [targetQuery, ...rest] = trimmed.split(/\s+/);
  const handoffMessage = rest.join(' ').trim();
  return {
    targetQuery,
    handoffMessage: handoffMessage.length > 0 ? handoffMessage : undefined,
  };
}

function extractForwardTargetName(message: string): string | undefined {
  for (const pattern of FORWARD_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;

    let target = match[1]
      .replace(/[?.!,]+$/, '')
      .replace(/^the\s+/i, '')
      .trim();

    if (!target) continue;

    // Strip trailing conjunctions or polite add-ons ("and introduce me", "please", etc.)
    target = target.replace(/\b(?:and|but|so|then|because|while|plus)\b.*$/i, '').trim();
    target = target.replace(/\b(?:please|thanks|thank you)\b.*$/i, '').trim();

    if (target) return target;
  }

  return undefined;
}

function detectResponseHandoff(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
): Agent | undefined {
  const directForward = detectForwardRequest(message, agentManager, currentAgentId);
  if (directForward) return directForward;

  for (const pattern of HANDOFF_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;

    const target = match[1]
      .replace(/[?.!,]+$/, '')
      .replace(/^the\s+/i, '')
      .trim();

    if (!target) continue;

    const matches = agentManager.resolveAgent(target);
    const filtered = matches.filter(a => a.id !== currentAgentId);
    if (filtered.length > 0) return filtered[0];
  }

  return undefined;
}

function detectResponseHandoffDirective(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
): { target?: Agent; message?: string } | undefined {
  const explicit = message.match(/^\s*HANDOFF:\s*([^|\n]+?)(?:\s*\|\s*([^\n]+))?\s*$/im);
  if (explicit) {
    const targetQuery = explicit[1].trim();
    const note = explicit[2]?.trim();
    if (targetQuery) {
      const matches = agentManager.resolveAgent(targetQuery);
      const filtered = matches.filter(a => a.id !== currentAgentId);
      if (filtered.length > 0) {
        return { target: filtered[0], message: note };
      }
    }
  }

  const fallback = detectResponseHandoff(message, agentManager, currentAgentId);
  if (fallback) {
    return { target: fallback };
  }

  return undefined;
}

function extractClaimedHandoffName(message: string): string | undefined {
  for (const pattern of HANDOFF_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;

    const target = match[1]
      .replace(/[?.!,]+$/, '')
      .replace(/^the\s+/i, '')
      .trim();

    if (target) return target;
  }

  return undefined;
}

function extractHireDirective(
  message: string,
  currentAgent: Agent,
): { name: string; role: string } | undefined {
  if (currentAgent.role !== 'hr-director') {
    return undefined;
  }

  const explicit = message.match(/^\s*HIRE:\s*([^|\n]+?)\s*\|\s*([a-z0-9][a-z0-9\- ]+)\s*$/im);
  if (explicit) {
    const name = explicit[1].trim();
    const role = explicit[2].trim().toLowerCase().replace(/\s+/g, '-');
    if (name && role) {
      return { name, role };
    }
  }

  const natural = message.match(
    /(?:hire|hiring|onboard|onboarding|bringing on)\s+([A-Z][A-Za-z' -]{2,60})\s+(?:as|for)\s+(?:a|an|the|our)?\s*([a-z][a-z0-9 -]{2,40})/i,
  );
  if (!natural) {
    return undefined;
  }

  const name = natural[1].trim();
  const role = natural[2].trim().toLowerCase().replace(/\s+/g, '-');
  if (!name || !role) {
    return undefined;
  }

  return { name, role };
}

async function createAgentFromChat(
  agentManager: AgentManager,
  hiringAgent: Agent,
  name: string,
  role: string,
  managerAgent?: Agent,
): Promise<Agent | undefined> {
  const id = name.toLowerCase().replace(/\s+/g, '-');
  const existingById = agentManager.getAgent(id);
  if (existingById) {
    return existingById;
  }

  const existingByRole = agentManager.getAllAgents().find(a => a.role.toLowerCase() === role.toLowerCase());
  if (existingByRole) {
    return existingByRole;
  }

  const lowerRole = role.toLowerCase();
  const personality = /architect|cto/.test(lowerRole)
    ? { communication_style: 'strategic' as const, expertise_level: 'senior' as const, mentoring: true }
    : /qa|test|security|data|analyst/.test(lowerRole)
      ? { communication_style: 'analytical' as const, expertise_level: 'mid-level' as const, mentoring: true }
      : /hr|people|recruit|headhunt/.test(lowerRole)
        ? { communication_style: 'supportive' as const, expertise_level: 'senior' as const, mentoring: true }
        : { communication_style: 'collaborative' as const, expertise_level: 'mid-level' as const, mentoring: true };

  const reportsTo = managerAgent?.id ?? hiringAgent.id;

  try {
    const created = await agentManager.createAgent({
      name,
      role,
      type: RoleType.INDIVIDUAL_CONTRIBUTOR,
      contextLevel: ContextLevel.MODULE,
      reportsTo,
      personality,
      avatar: {
        type: 'ai-generated',
        style: 'professional-headshot',
        seed: `${id}-${role}`,
      },
    });

    return created;
  } catch {
    return undefined;
  }
}

// ============================================================================
// In-chat command parsing
// ============================================================================

const KNOWN_COMMANDS = [
  'chat',
  'list',
  'who',
  'hire',
  'help',
  'graph',
  'overview',
  'history',
  'portfolio',
  'bio',
  'info',
  'fire',
  'create',
  'init',
  'hh',
  'test-connection',
  'run',
  'shell',
];

interface InChatCommand {
  name: string;
  args?: string;
}

interface DirectToolCall {
  toolName: string;
  params: Record<string, unknown>;
}

function isArchitectLikeRole(role: string): boolean {
  return /architect|cto/i.test(role);
}

async function getWorkspaceOverview(workspaceRoot: string): Promise<string> {
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', '.pnpm-store']);
  const lines: string[] = [];
  const maxDepth = 2;
  const maxEntries = 120;
  let emitted = 0;

  async function walk(currentPath: string, relativePath: string, depth: number): Promise<void> {
    if (depth > maxDepth || emitted >= maxEntries) return;

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (emitted >= maxEntries) break;
      if (entry.name.startsWith('.') && entry.name !== '.ai-team') continue;

      const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childAbs = `${currentPath}/${entry.name}`;

      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        lines.push(`${'  '.repeat(depth)}- ${childRel}/`);
        emitted++;
        await walk(childAbs, childRel, depth + 1);
      } else {
        lines.push(`${'  '.repeat(depth)}- ${childRel}`);
        emitted++;
      }
    }
  }

  await walk(workspaceRoot, '', 0);

  const rootImportant = ['package.json', 'pnpm-workspace.yaml', 'tsconfig.json', 'README.md', 'ARCHITECTURE.md'];
  const foundImportant: string[] = [];
  for (const filename of rootImportant) {
    try {
      await fs.stat(`${workspaceRoot}/${filename}`);
      foundImportant.push(filename);
    } catch {
      // ignore missing file
    }
  }

  return [
    'Workspace snapshot (truncated):',
    foundImportant.length > 0 ? `Root key files: ${foundImportant.join(', ')}` : 'Root key files: none detected',
    ...lines,
    emitted >= maxEntries ? '(truncated)' : '',
  ].filter(Boolean).join('\n');
}

/**
 * Parse a user message as an in-chat command.
 * Returns the parsed command or undefined if it's a normal message.
 *
 * Recognised formats:
 *   "/chat hr"        → { name: 'chat', args: 'hr' }
 *   "/list"           → { name: 'list' }
 *   "/hire"           → { name: 'hire' }
 *   "/help"           → { name: 'help' }
 *   "/graph"          → { name: 'graph' }
 */
function parseInChatCommand(message: string): InChatCommand | undefined {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) {
    return undefined;
  }

  const withoutPrefix = trimmed.slice(1).trim();
  if (!withoutPrefix) {
    return undefined;
  }

  const [first, ...rest] = withoutPrefix.split(/\s+/);
  const cmd = (first || '').toLowerCase();

  if (KNOWN_COMMANDS.includes(cmd)) {
    return {
      name: cmd,
      args: rest.length > 0 ? rest.join(' ') : undefined,
    };
  }

  return undefined;
}

function parseDirectToolCall(message: string): DirectToolCall | undefined {
  const trimmed = message.trim();

  let payload: string | undefined;
  if (trimmed.startsWith('#')) {
    payload = trimmed.slice(1).trim();
  } else if (/^\/tool\b/i.test(trimmed)) {
    payload = trimmed.replace(/^\/tool\b/i, '').trim();
  }

  if (!payload) {
    return undefined;
  }

  const match = payload.match(/^([a-zA-Z0-9_-]+)(?:\s+([\s\S]+))?$/);
  if (!match) {
    return undefined;
  }

  const toolName = match[1];
  const rawParams = match[2]?.trim();

  if (!ALL_TOOLS[toolName]) {
    console.log(chalk.yellow(`Unknown tool '${toolName}'.`));
    return undefined;
  }

  if (!rawParams) {
    return { toolName, params: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawParams);
  } catch {
    console.log(chalk.yellow('Direct tool params must be valid JSON object syntax.'));
    console.log(chalk.dim('Example: #run_cli_tool {"command":"git","args":["status","--short"]}'));
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.log(chalk.yellow('Direct tool params must be a JSON object.'));
    return undefined;
  }

  return {
    toolName,
    params: parsed as Record<string, unknown>,
  };
}

function isDirectToolSyntax(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.startsWith('#') || /^\/tool\b/i.test(trimmed);
}

async function executeDirectToolCall(
  directToolCall: DirectToolCall,
  chatManager: ChatManager,
  history: ChatMessage[],
  agent: Agent,
  workspaceRoot: string,
  contextFiles?: string[],
) {
  const { toolName, params } = directToolCall;
  const allowedTools = getAgentTools(agent);
  const toolLabel = `${toolName}(${formatToolArgs(params)})`;
  const isAllowedForAgent = Boolean(allowedTools[toolName]);

  if (isAllowedForAgent) {
    const approved = await confirm({
      message: `Allow ${agent.name} to run direct tool ${toolLabel}?`,
      default: false,
    });

    if (!approved) {
      console.log(chalk.dim('Direct tool call canceled by user.'));
      return;
    }

    const execution = await executeAgentTool(
      {
        toolName,
        params,
        context: {
          agent,
          workspaceRoot,
          currentFiles: contextFiles,
        },
      },
      {
        onBeforeExecute: () => true,
      },
    );

    if (!execution.ok) {
      console.log(chalk.red(`Direct tool call failed: ${execution.error || 'Unknown error'}`));
      return;
    }

    const outputText = stringifyToolPayload(execution.result);
    console.log(chalk.bold('\nDirect Tool Output\n'));
    console.log(outputText);
    console.log();

    await appendToolOutputToHistory(chatManager, history, agent.id, execution.toolName, outputText);
    console.log(chalk.dim('  (Shared direct tool output with ') + chalk.cyan(agent.name) + chalk.dim(' for future context.)'));
    return;
  }

  const approvedOverride = await confirm({
    message:
      `Tool '${toolName}' is not allowed for ${agent.name}. Run as private developer override `
      + '(output will not be shared with agent context)?',
    default: false,
  });

  if (!approvedOverride) {
    console.log(chalk.dim('Private override canceled by user.'));
    return;
  }

  const overrideAgent: Agent = {
    ...agent,
    tools: [...new Set([...(agent.tools || []), toolName])],
  };

  const execution = await executeAgentTool(
    {
      toolName,
      params,
      context: {
        agent: overrideAgent,
        workspaceRoot,
        currentFiles: contextFiles,
      },
    },
    {
      onBeforeExecute: () => true,
    },
  );

  if (!execution.ok) {
    console.log(chalk.red(`Private tool call failed: ${execution.error || 'Unknown error'}`));
    console.log(chalk.dim('Tool output was not written to chat history.'));
    return;
  }

  const outputText = stringifyToolPayload(execution.result);
  console.log(chalk.bold('\nPrivate Tool Output\n'));
  console.log(outputText);
  console.log();
  console.log(chalk.dim('Tool output was intentionally kept out of agent context.'));
}

/**
 * Resolve an agent switch from a "chat <query>" command.
 * If multiple agents match, shows a selection prompt.
 * Returns undefined if no match or user cancels.
 */
async function resolveSwitch(
  query: string,
  agentManager: AgentManager,
  currentAgentId: string,
): Promise<Agent | undefined> {
  const matches = agentManager.resolveAgent(query);
  if (matches.length === 0) return undefined;

  // Prefer matches that aren't the current agent
  const filtered = matches.filter(a => a.id !== currentAgentId);
  const candidates = filtered.length > 0 ? filtered : matches;

  if (candidates.length === 1) return candidates[0];

  // Multiple matches — let the user pick
  const chosen = await select({
    message: `Multiple agents match "${query}". Which one?`,
    choices: candidates.map(a => ({
      name: `${a.name} — ${a.role} [${a.id}]`,
      value: a.id,
    })),
  });
  return agentManager.getAgent(chosen);
}

/**
 * Print available in-chat commands.
 */
function printChatHelp() {
  console.log(chalk.bold('\n  In-chat commands:\n'));
  console.log(chalk.dim('  CLI (outside chat): ait chat <name|role>'));
  console.log(chalk.dim('  In chat:            /chat <name|role> [handoff note]'));
  console.log(chalk.dim('  Example:            /chat linda Please review the API contract draft'));
  console.log(`  ${chalk.cyan('/chat <name|role>')}  Switch to another agent`);
  console.log(`  ${chalk.cyan('/list')}              List all team members`);
  console.log(`  ${chalk.cyan('/who')}               Show who you are currently talking to`);
  console.log(`  ${chalk.cyan('/hire')}              Hire a new team member`);
  console.log(`  ${chalk.cyan('/overview')}          Show workspace file overview`);
  console.log(`  ${chalk.cyan('/run <command>')}     Run a shell command and share its output`);
  console.log(`  ${chalk.cyan('/info <agent>')}      Show detailed profile for an agent`);
  console.log(`  ${chalk.cyan('/fire <agent>')}      Remove an agent`);
  console.log(`  ${chalk.cyan('/create [agent|skill]')} Create a team member or skill`);
  console.log(`  ${chalk.cyan('/hh refresh')}        Refresh skills catalog`);
  console.log(`  ${chalk.cyan('/test-connection')}   Test LLM connectivity`);
  console.log(`  ${chalk.cyan('/init')}              Re-run workspace init`);
  console.log(`  ${chalk.cyan('/history')}           Show recent messages (history 20 for more)`);
  console.log(`  ${chalk.cyan('/portfolio')}         Show the agent's portfolio / bio`);
  console.log(`  ${chalk.cyan('/graph')}             Show team org graph`);
  console.log(`  ${chalk.cyan('/help')}              Show this help`);
  console.log(`  ${chalk.cyan('#<tool> <json>')}     Run a direct tool call`);
  console.log(`  ${chalk.cyan('/tool <tool> <json>')} Alias for direct tool call`);
  console.log(`  ${chalk.cyan('exit')}              End the conversation`);
  console.log(chalk.dim('\n  Or just ask to be "forwarded to" someone.\n'));
}

function formatUserPrompt(agent: Agent): string {
  return chalk.green(`You → ${agent.name} (${agent.role}):`);
}

function printCurrentChatTarget(agent: Agent) {
  console.log(chalk.bold('\nCurrent chat target\n'));
  console.log(chalk.dim('  Name: ') + chalk.cyan(agent.name));
  console.log(chalk.dim('  Role: ') + agent.role);
  console.log(chalk.dim('  ID:   ') + agent.id);
}

/**
 * Print recent chat history with the current agent.
 * Defaults to last 10 messages; pass a number to see more.
 */
function printHistory(history: ChatMessage[], agent: Agent, countArg?: string) {
  const count = countArg ? parseInt(countArg, 10) || 10 : 10;
  const recent = history.slice(-count);

  if (recent.length === 0) {
    console.log(chalk.dim('\n  No messages yet.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Last ${recent.length} message(s) with ${agent.name}:\n`));
  for (const msg of recent) {
    const time = new Date(msg.timestamp).toLocaleTimeString();
    if (msg.from === 'human') {
      console.log(chalk.dim(`  [${time}] `) + chalk.green('You: ') + msg.content);
    } else {
      console.log(chalk.dim(`  [${time}] `) + chalk.cyan(`${agent.name}: `) + msg.content);
    }
  }
  console.log();
}

/**
 * Print the agent's portfolio — their .md file contents (frontmatter + bio).
 */
async function printPortfolio(agent: Agent) {
  console.log(chalk.bold(`\n  Portfolio: ${agent.name} (${agent.role})\n`));

  // Core fields
  console.log(chalk.dim('  ID:           ') + agent.id);
  console.log(chalk.dim('  Role:         ') + agent.role);
  console.log(chalk.dim('  Type:         ') + (agent.type || 'n/a'));
  console.log(chalk.dim('  Context:      ') + (agent.contextLevel || 'n/a'));
  if (agent.reportsTo) {
    console.log(chalk.dim('  Reports to:   ') + agent.reportsTo);
  }
  if (agent.specializations && agent.specializations.length > 0) {
    console.log(chalk.dim('  Specializations: ') + agent.specializations.join(', '));
  }
  if (agent.personality) {
    const p = agent.personality;
    if (p.communication_style) console.log(chalk.dim('  Style:        ') + p.communication_style);
    if (p.expertise_level) console.log(chalk.dim('  Expertise:    ') + p.expertise_level);
  }
  if (agent.createdAt) {
    console.log(chalk.dim('  Created:      ') + new Date(agent.createdAt).toLocaleDateString());
  }
  if (agent.lastInteraction) {
    console.log(chalk.dim('  Last active:  ') + new Date(agent.lastInteraction).toLocaleDateString());
  }
  if (agent.conversationCount) {
    console.log(chalk.dim('  Messages:     ') + agent.conversationCount);
  }

  // Bio / markdown body
  if (agent.markdown?.trim()) {
    console.log(chalk.dim('\n  ─── Bio ───'));
    for (const line of agent.markdown.trim().split('\n')) {
      console.log('  ' + line);
    }
  }

  // Raw file
  console.log(chalk.dim(`\n  File: ${agent.filePath}`));
  console.log();
}

async function appendToolOutputToHistory(
  chatManager: ChatManager,
  history: ChatMessage[],
  agentId: string,
  toolName: string,
  output: string,
) {
  const MAX_CONTEXT_CHARS = 4000;
  let content = output.trim();
  if (content.length > MAX_CONTEXT_CHARS) {
    content = content.slice(0, MAX_CONTEXT_CHARS) + '\n...(truncated)...';
  }

  const message: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    content: `Tool Output (${toolName}):\n${content}`,
  };

  await chatManager.appendMessage(agentId, message);
  history.push(message);
}

async function appendHandoffNote(
  chatManager: ChatManager,
  history: ChatMessage[],
  agentId: string,
  fromAgent: Agent,
  note: string,
) {
  const trimmed = note.trim();
  const content = `Handoff note from ${fromAgent.name} (${fromAgent.role}):\n${trimmed}`;
  const message: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    content,
  };
  await chatManager.appendMessage(agentId, message);
  history.push(message);
}

async function acknowledgeHandoff(
  llm: LlmService,
  chatManager: ChatManager,
  agentManager: AgentManager,
  agent: Agent,
  history: ChatMessage[],
  skill: import('@ai-team/core').Skill | undefined,
  fromAgent: Agent,
  note: string,
) {
  const trimmedNote = note?.trim();
  if (!trimmedNote) {
    return;
  }

  const truncated = truncateForPrompt(trimmedNote, 1600);
  const instructions =
    `You just received a handoff from ${fromAgent.name} (${fromAgent.role}). `
    + 'Acknowledge that context before taking action, restate the requested outcome in your own words, '
    + 'and ask the developer to confirm or add constraints before you proceed. '
    + 'Offer to sync with the originating teammate if anything is unclear. Here is the note you received:\n\n'
    + truncated;

  const messages: ChatCompletionMessageParam[] = [
    { role: 'user', content: instructions },
  ];

  const teamRoster = agentManager.getAllAgents();
  process.stdout.write(chalk.cyan(`\n${agent.name}`) + chalk.dim(` (${agent.role})`) + chalk.cyan(': '));

  let fullResponse = '';
  let llmOptions: LlmChatOptions | undefined;
  try {
    llmOptions = await configureLlmForAgent(agentManager.workspaceRoot, llm, agent, skill);
    const stream = await llm.streamChat(agent, messages, llmOptions, skill, teamRoster);
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        process.stdout.write(delta);
        fullResponse += delta;
      }
    }
  } catch (error) {
    console.error(
      chalk.red('\nLLM unavailable during handoff acknowledgement:'),
      formatLlmError(error),
    );
    console.log(chalk.dim(`Attempted provider/model: ${formatLlmAttempt(llm, llmOptions)}`));
    return;
  }

  process.stdout.write('\n\n');

  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    content: fullResponse.trim(),
  };
  await chatManager.appendMessage(agent.id, agentMsg);
  history.push(agentMsg);
  await agentManager.recordInteraction(agent.id);
}

async function seedNewHireContext(
  chatManager: ChatManager,
  newAgent: Agent,
  manager: Agent,
  contextNote?: string,
) {
  const trimmedNote = contextNote?.trim();
  const truncated = trimmedNote ? truncateForPrompt(trimmedNote, 1800) : undefined;
  const lines: string[] = [];
  lines.push(`Onboarding brief from ${manager.name} (${manager.role}).`);
  if (truncated) {
    lines.push('Context from the originating request:');
    lines.push(truncated);
  } else {
    lines.push('No detailed brief was attached. Sync with your manager immediately to capture requirements.');
  }
  lines.push('');
  lines.push(`You report directly to ${manager.name}. Confirm ownership of your files/modules before making changes.`);

  const message: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    content: lines.join('\n'),
  };

  await chatManager.appendMessage(newAgent.id, message);
  console.log(chalk.dim('  Shared onboarding brief with ') + chalk.cyan(newAgent.name) + chalk.dim('.'));
}

async function configureLlmForAgent(
  _workspaceRoot: string,
  llm: LlmService,
  agent: Agent,
  skill?: import('@ai-team/core').Skill,
): Promise<LlmChatOptions | undefined> {
  return llm.initializeForChat(agent, skill);
}

function truncateForPrompt(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n...(truncated)...`;
}

function formatLlmError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('timed out')) {
    return `${message} The model endpoint did not respond in time.`;
  }

  return message;
}

function formatLlmAttempt(llm: LlmService, options?: LlmChatOptions): string {
  try {
    const providerName = llm.providerName;
    const provider = llm.provider;
    const model = options?.model || llm.modelName;
    if (providerName) {
      return `${providerName} (${provider}) / ${model}`;
    }
    return `${provider} / ${model}`;
  } catch {
    return '(unresolved)';
  }
}

function shouldFallbackToPlainChat(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return normalized.includes('400 status code')
    || normalized.includes('tool')
    || normalized.includes('function')
    || normalized.includes('invalid_request_error')
    || normalized.includes('unsupported');
}

function shouldRequireToolCall(message: string): boolean {
  const normalized = message.toLowerCase();
  const patterns = [
    'search',
    'find',
    'lookup',
    'look up',
    'grep',
    'error',
    'errors',
    'diagnose',
    'debug',
    'read file',
    'inspect',
    'analyze',
    'git status',
    'status of git',
    'repo status',
  ];

  return patterns.some(pattern => normalized.includes(pattern));
}

function parseCliGrantRequest(message: string): { employee: string; command: string } | undefined {
  const normalized = message.trim();
  const patterns = [
    /(?:hey\s+\w+[\s,]*)?allow\s+(.+?)\s+to\s+use\s+([a-zA-Z0-9_.-]+)/i,
    /grant\s+(.+?)\s+(?:access\s+to\s+|for\s+)?([a-zA-Z0-9_.-]+)\s*(?:command|tool)?/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const employee = match[1]?.trim();
    const command = match[2]?.trim().toLowerCase();
    if (employee && command) {
      return { employee, command };
    }
  }

  return undefined;
}

function parseEmployeeLlmUpdateRequest(message: string): {
  employee: string;
  provider?: string;
  modelKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
} | undefined {
  const normalized = message.trim();
  const employeeMatch = normalized.match(/(?:set|change|update)\s+(.+?)\s+(?:model|model\s+key|provider|temperature|max\s*tokens|top\s*p|presence\s*penalty|frequency\s*penalty)/i);
  if (!employeeMatch) {
    return undefined;
  }

  const employee = employeeMatch[1]?.trim();
  if (!employee) {
    return undefined;
  }

  const modelKeyMatch = normalized.match(/model\s+key\s+(?:to\s+)?([a-zA-Z0-9._/-]+)/i);
  const modelMatch = normalized.match(/(?:^|\s)model\s+(?:to\s+)?([a-zA-Z0-9._/-]+)/i);
  const providerMatch = normalized.match(/provider\s+(?:to\s+)?([a-zA-Z0-9._-]+)/i);
  const tempMatch = normalized.match(/temperature\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/i);
  const maxTokensMatch = normalized.match(/max\s*tokens\s+(?:to\s+)?(\d+)/i);
  const topPMatch = normalized.match(/top\s*p\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/i);
  const presenceMatch = normalized.match(/presence\s*penalty\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/i);
  const frequencyMatch = normalized.match(/frequency\s*penalty\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/i);

  const request = {
    employee,
    provider: providerMatch?.[1]?.trim(),
    modelKey: modelKeyMatch?.[1]?.trim(),
    model: modelMatch?.[1]?.trim(),
    temperature: tempMatch ? Number(tempMatch[1]) : undefined,
    maxTokens: maxTokensMatch ? Number(maxTokensMatch[1]) : undefined,
    topP: topPMatch ? Number(topPMatch[1]) : undefined,
    presencePenalty: presenceMatch ? Number(presenceMatch[1]) : undefined,
    frequencyPenalty: frequencyMatch ? Number(frequencyMatch[1]) : undefined,
  };

  const hasUpdate = request.provider !== undefined
    || request.modelKey !== undefined
    || request.model !== undefined
    || request.temperature !== undefined
    || request.maxTokens !== undefined
    || request.topP !== undefined
    || request.presencePenalty !== undefined
    || request.frequencyPenalty !== undefined;

  if (!hasUpdate) {
    return undefined;
  }

  return request;
}

function buildModelToolParameters(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true,
    };
  }

  return {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: true,
  };
}

function formatToolArgs(args: unknown): string {
  const text = stringifyToolPayload(args);
  if (text.length <= 120) {
    return text;
  }
  return `${text.slice(0, 120)}...`;
}

function stringifyToolPayload(payload: unknown): string {
  if (payload === undefined) {
    return 'undefined';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

async function runShellCommand(
  command: string,
  workspaceRoot: string,
  chatManager: ChatManager,
  history: ChatMessage[],
  agent: Agent,
) {
  const trimmed = command.trim();
  if (!trimmed) {
    console.log(chalk.yellow('No command provided.'));
    return;
  }

  const proceed = await confirm({
    message: `Run shell command: ${trimmed}?`,
    default: false,
  });

  if (!proceed) {
    console.log(chalk.dim('Command aborted.'));
    return;
  }

  console.log(chalk.dim(`\n$ ${trimmed}`));

  const formatOutput = (stdout?: string, stderr?: string) => {
    const parts: string[] = [];
    if (stdout && stdout.trim().length > 0) {
      parts.push(stdout.trim());
    }
    if (stderr && stderr.trim().length > 0) {
      parts.push('stderr:\n' + stderr.trim());
    }
    return parts.join('\n\n');
  };

  try {
    const { stdout, stderr } = await execAsync(trimmed, {
      cwd: workspaceRoot,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    });
    const output = formatOutput(stdout, stderr);
    if (output.length > 0) {
      console.log(output);
    } else {
      console.log(chalk.dim('(no output)'));
    }
    await appendToolOutputToHistory(chatManager, history, agent.id, `shell:${trimmed}`, output || '(no output)');
    console.log(chalk.dim('  (Shared command output with ') + chalk.cyan(agent.name) + chalk.dim('.)'));
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = formatOutput(err.stdout, err.stderr) || err.message;
    console.log(chalk.red('Command failed:'));
    console.log(output);
    await appendToolOutputToHistory(chatManager, history, agent.id, `shell:${trimmed}`, output);
    console.log(chalk.dim('  (Shared failed command output with ') + chalk.cyan(agent.name) + chalk.dim('.)'));
  }
}

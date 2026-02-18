/**
 * Chat command - chat with an agent
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { AgentManager, ChatManager, ChatMessage } from '@ai-team/core';

interface ChatOptions {
  message?: string;
  context?: string[];
}

export async function chatCommand(agentId: string, options: ChatOptions) {
  try {
    const workspaceRoot = process.cwd();
    const agentManager = new AgentManager(workspaceRoot);
    const chatManager = new ChatManager(workspaceRoot);

    await agentManager.initialize();

    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      console.error(chalk.red(`Agent not found: ${agentId}`));
      console.log('Run ' + chalk.cyan('ai-team list') + ' to see available agents.');
      process.exit(1);
    }

    console.log(chalk.bold(`\nChat with ${chalk.cyan(agent.name)}`));
    console.log(chalk.dim(`Role: ${agent.role}`));
    console.log(chalk.dim('Type "exit" to end the conversation\n'));

    // Load chat history
    const history = await chatManager.loadChatHistory(agentId);
    if (history.length > 0) {
      console.log(chalk.dim(`(${history.length} previous messages)`));
    }

    // Single message mode
    if (options.message) {
      await sendMessage(
        chatManager,
        agentManager,
        agent.id,
        options.message,
        options.context
      );
      return;
    }

    // Interactive chat loop
    while (true) {
      const { message } = await inquirer.prompt([
        {
          type: 'input',
          name: 'message',
          message: chalk.green('You:'),
          validate: (input: string) => input.length > 0 || 'Message cannot be empty',
        },
      ]);

      if (message.toLowerCase() === 'exit') {
        console.log(chalk.dim('Goodbye!'));
        break;
      }

      await sendMessage(chatManager, agentManager, agent.id, message, options.context);
    }
  } catch (error) {
    console.error(chalk.red('Error in chat:'), error);
    process.exit(1);
  }
}

async function sendMessage(
  chatManager: ChatManager,
  agentManager: AgentManager,
  agentId: string,
  message: string,
  contextFiles?: string[]
) {
  // Save user message
  const userMessage: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    content: message,
    context: contextFiles,
  };

  await chatManager.appendMessage(agentId, userMessage);

  // TODO: Integrate with LLM to get agent response
  // For now, just echo back a placeholder
  console.log(chalk.cyan(`\n${agentId}:`), chalk.dim('(LLM integration pending)'));
  console.log(chalk.dim(`  Received: "${message}"`));
  console.log(chalk.dim(`  Context: ${contextFiles?.join(', ') || 'none'}\n`));

  // Record interaction
  await agentManager.recordInteraction(agentId);

  // Save agent response (placeholder)
  const agentMessage: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agentId,
    content: `I received your message: "${message}". LLM integration is pending.`,
  };

  await chatManager.appendMessage(agentId, agentMessage);
}

import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const chatCliMetadata: CliCommandMetadata = {
  key: 'chat',
  command: 'chat [agent-id]',
  description: 'Start a chat session with an employee',
  llmCallable: false,
  directCli: true,
  arguments: [
    { syntax: '[message...]', description: 'Optional inline message to send immediately' },
  ],
  options: [
    { flags: '-m, --message <message>', description: 'Send a single message' },
    { flags: '-c, --context <files...>', description: 'Include files in context' },
    { flags: '--mediator-log', description: 'Print raw mediator runtime/stream event logs' },
    { flags: '--new', description: 'Start a new session instead of resuming the latest' },
    { flags: '-s, --session <id>', description: 'Resume a specific session by ID' },
  ],
};

export const chatCommandDefinition = createFactoryCommandDefinition(
  'chat',
  chatCliMetadata,
  async (container, payload, context) => {
    const { chatCommand } = await import('@ai-team/service/src/commands/chat/index.js');
    return chatCommand(container.workspaceRoot, payload.employeeId, payload.options, {
      signal: context.signal,
      emit: context.emit,
      questionInput: context.questionInput,
      questionConfirm: context.questionConfirm,
      questionSelect: context.questionSelect,
      questionPassword: context.questionPassword,
      questionChecklist: context.questionChecklist,
      workflowState: context.workflowState,
      onWorkflowFrame: context.onWorkflowFrame,
    });
  }
);

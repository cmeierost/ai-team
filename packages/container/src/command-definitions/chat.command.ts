import type { CliCommandMetadata, ILlmService } from '@ai-team/core';
import { AgentDocumentStorage, WorkspaceDiscoveryStorage } from '@ai-team/infrastructure';
import { TOKENS } from '../service-bootstrap.js';
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
    const { ChatCommand } = await import('@ai-team/service/src/commands/chat/index.js');
    const agentDocStorage = new AgentDocumentStorage(
      container.resolve(TOKENS.MarkdownSectionService),
      container.resolve(TOKENS.WorkspaceStorage),
      new WorkspaceDiscoveryStorage()
    );
    const cmd = new ChatCommand(
      container.resolve(TOKENS.ConfigurationStorage),
      container.resolve(TOKENS.EnvironmentStorage),
      agentDocStorage
    );
    return cmd.execute(
      container.workspaceRoot,
      payload.employeeId,
      payload.options,
      {
        signal: context.signal,
        emit: context.emit,
        questionInput: context.questionInput,
        questionConfirm: context.questionConfirm,
        questionSelect: context.questionSelect,
        questionPassword: context.questionPassword,
        questionChecklist: context.questionChecklist,
        workflowState: context.workflowState,
        onWorkflowFrame: context.onWorkflowFrame,
      },
      {
        sessionManager: container.resolve(TOKENS.SessionManager),
        agentManager: container.resolve(TOKENS.AgentManager),
        llmService: container.resolve(TOKENS.LlmService) as unknown as ILlmService,
        skillManager: container.resolve(TOKENS.SkillManager),
        markdownSectionService: container.resolve(TOKENS.MarkdownSectionService),
        pathPermissionChecker: container.resolve(TOKENS.PathPermissionChecker),
      }
    );
  }
);

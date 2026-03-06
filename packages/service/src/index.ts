import { listEmployeesCommand } from './commands/list.js';
import { getOrganizationGraphCommand, getTeamGraphCommand } from './commands/graph.js';
import { resolveEmployeesCommand } from './commands/info.js';
import { searchAgentsCommand } from './commands/search.js';
import {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  AiTeamMediator,
  MediatorContext,
  MediatorEvent,
  MediatorRuntimeEvent,
  MediatorRequest,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionRequest,
  QuestionSelectChoice,
  QuestionSelectRequest,
  QuestionWorkflowMetadata,
  AiTeamService,
  ChatOptions,
  AddProviderOptions,
  ConfigureProviderOptions,
  SetProviderOptions,
  CreateAgentSetupInput,
  CreateOptions,
  CreateSetupInput,
  CreateSkillSetupInput,
  Employee,
  FireOptions,
  HireOptions,
  InitOptions,
  ListEmployeesRequest,
  SearchAgentsRequest,
  SearchAgentsResponse,
  ProviderSetupInput,
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  WorkflowFrame,
  WorkflowStateSnapshot,
  TestConnectionOptions,
} from './contracts.js';
import { GraphData, ViewMode } from '@ai-team/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import { providerListCommand, providerModelsCommand, providerModelsRefreshCommand } from './commands/models.js';
import { testConnectionCommand } from './commands/test-connection.js';
import { createCommand } from './commands/create.js';
import { chatCommand } from './commands/chat/index.js';
import { fireCommand } from './commands/fire.js';
import { hhRefreshCommand } from './commands/hh.js';
import { hireCommand } from './commands/hire.js';
import { initCommand } from './commands/init.js';
import { providerAddCommand, providerConfigureCommand, providerSetCommand } from './commands/provider.js';
import { toServiceDomainError } from './errors.js';
import { WorkflowStateStore } from './workflow-state.js';
import { writeBackendDebugLog } from './utils/debug-log.js';
export {
  CLI_COMMAND_REGISTRY,
  IN_CHAT_COMMAND_ALIASES,
  IN_CHAT_COMMAND_REGISTRY,
  getCliCommandMetadata,
  getLlmCallableCliCommands,
} from './command-registry.js';

const STDOUT_CAPTURE_SCOPE = new AsyncLocalStorage<boolean>();
const STDOUT_CAPTURE_BYPASS_SCOPE = new AsyncLocalStorage<boolean>();

function runWithoutStdoutCapture<T>(task: () => Promise<T>): Promise<T> {
  return STDOUT_CAPTURE_BYPASS_SCOPE.run(true, task);
}

function formatRuntimeConsoleArgs(args: unknown[]): string {
  if (args.length === 0) {
    return '';
  }

  if (typeof args[0] === 'string') {
    return String(args[0]);
  }

  return args.map(part => {
    if (typeof part === 'string') {
      return part;
    }

    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  }).join(' ');
}

class CoreAiTeamService implements AiTeamService {
  public readonly workspaceRoot: string;
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async invoke<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context: MediatorContext = {},
  ): Promise<AiTeamCommandResponseMap[TCommand]> {
    if (context.signal?.aborted) {
      throw new Error('Mediator invocation aborted');
    }

    context.emit?.({
      kind: 'status',
      phase: 'dispatch',
      message: `Dispatching command '${request.command}'`,
    });
    writeBackendDebugLog(this.workspaceRoot, {
      source: 'invoke',
      phase: 'dispatch',
      command: request.command,
      requestId: request.requestId,
      payload: request.payload,
    });

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);

    // Wrap emit so every event reaches the client AND is mirrored to the
    // real server console (log → console.log/warn/error, token → stdout).
    // This gives full visibility when running the service behind the API
    // server without affecting the CLI path (where context.emit is absent).
    // Wrap emit so every event reaches the client via the event queue.
    // Do NOT mirror log events back to console.log/warn/error here:
    // originalLog still calls process.stdout.write (which is patched when
    // context.emit is present), so mirroring would emit a second token event
    // for every log message and cause double-printing in the CLI.
    const emitWithConsole: ((event: MediatorRuntimeEvent) => void) | undefined = context.emit
      ? (event: MediatorRuntimeEvent) => {
          context.emit!(event);
        }
      : undefined;

    if (context.emit) {
      console.log = (...args: unknown[]) => {
        emitWithConsole!({
          kind: 'log',
          level: 'info',
          message: formatRuntimeConsoleArgs(args),
        });
      };

      console.warn = (...args: unknown[]) => {
        emitWithConsole!({
          kind: 'log',
          level: 'warn',
          message: formatRuntimeConsoleArgs(args),
        });
      };

      console.error = (...args: unknown[]) => {
        emitWithConsole!({
          kind: 'log',
          level: 'error',
          message: formatRuntimeConsoleArgs(args),
        });
      };

      process.stdout.write = ((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
        if (!STDOUT_CAPTURE_SCOPE.getStore() || STDOUT_CAPTURE_BYPASS_SCOPE.getStore()) {
          if (typeof encoding === 'function') {
            return originalStdoutWrite(chunk as never, encoding as never);
          }
          return originalStdoutWrite(chunk as never, encoding as never, cb as never);
        }

        const text = typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString(typeof encoding === 'string' ? encoding : undefined)
            : String(chunk);

        emitWithConsole!({
          kind: 'token',
          text,
        });

        if (typeof encoding === 'function') {
          encoding(null);
          return true;
        }
        if (cb) {
          cb(null);
        }
        return true;
      }) as typeof process.stdout.write;
    }

    const invokeCore = async (): Promise<AiTeamCommandResponseMap[TCommand]> => {
      let response: AiTeamCommandResponseMap[TCommand];
      switch (request.command) {
        case 'listEmployees':
          response = await this.listEmployees(request.payload as ListEmployeesRequest) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'resolveEmployees':
          response = await this.resolveEmployees((request.payload as { query: string }).query) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'getTeamGraph':
          response = await this.getTeamGraph((request.payload as { mode?: ViewMode }).mode) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'getOrganizationGraph':
          response = await this.getOrganizationGraph() as AiTeamCommandResponseMap[TCommand];
          break;
        case 'create': {
          const payload = request.payload as { type: string; options: CreateOptions };
          response = await this.create(payload.type, payload.options) as AiTeamCommandResponseMap[TCommand];
          break;
        }
        case 'chat': {
          const payload = request.payload as { employeeId?: string; options: ChatOptions };
          const workflowStateStore = new WorkflowStateStore(this.workspaceRoot);
          const persistedWorkflowState = workflowStateStore.loadForCommand('chat');
          response = await chatCommand(this.workspaceRoot, payload.employeeId, payload.options, {
            signal: context.signal,
            emit: emitWithConsole,
            questionInput: context.questionInput
              ? (request) => runWithoutStdoutCapture(() => context.questionInput!(request))
              : undefined,
            questionConfirm: context.questionConfirm
              ? (request) => runWithoutStdoutCapture(() => context.questionConfirm!(request))
              : undefined,
            questionSelect: context.questionSelect
              ? (request) => runWithoutStdoutCapture(() => context.questionSelect!(request))
              : undefined,
            questionPassword: context.questionPassword
              ? (request) => runWithoutStdoutCapture(() => context.questionPassword!(request))
              : undefined,
            questionChecklist: context.questionChecklist
              ? (request) => runWithoutStdoutCapture(() => context.questionChecklist!(request))
              : undefined,
            workflowState: context.workflowState || persistedWorkflowState,
            onWorkflowFrame: (frame) => {
              workflowStateStore.handleFrame('chat', frame);
              context.onWorkflowFrame?.(frame);
            },
          }) as AiTeamCommandResponseMap[TCommand];
          break;
        }
        case 'hire':
          response = await this.hire((request.payload as { options: HireOptions }).options) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'fire': {
          const payload = request.payload as { employeeQuery: string; options: FireOptions };
          response = await this.fire(payload.employeeQuery, payload.options) as AiTeamCommandResponseMap[TCommand];
          break;
        }
        case 'init':
          {
          const workflowStateStore = new WorkflowStateStore(this.workspaceRoot);
          const persistedWorkflowState = workflowStateStore.loadForCommand('init');
          response = await initCommand(this.workspaceRoot, (request.payload as { options: InitOptions }).options, {
            signal: context.signal,
            emit: emitWithConsole,
            questionInput: context.questionInput
              ? (request) => runWithoutStdoutCapture(() => context.questionInput!(request))
              : undefined,
            questionConfirm: context.questionConfirm
              ? (request) => runWithoutStdoutCapture(() => context.questionConfirm!(request))
              : undefined,
            questionSelect: context.questionSelect
              ? (request) => runWithoutStdoutCapture(() => context.questionSelect!(request))
              : undefined,
            questionPassword: context.questionPassword
              ? (request) => runWithoutStdoutCapture(() => context.questionPassword!(request))
              : undefined,
            questionChecklist: context.questionChecklist
              ? (request) => runWithoutStdoutCapture(() => context.questionChecklist!(request))
              : undefined,
            workflowState: context.workflowState || persistedWorkflowState,
            onWorkflowFrame: (frame) => {
              workflowStateStore.handleFrame('init', frame);
              context.onWorkflowFrame?.(frame);
            },
          }) as AiTeamCommandResponseMap[TCommand];
          break;
          }
        case 'hhRefresh':
          response = await this.hhRefresh() as AiTeamCommandResponseMap[TCommand];
          break;
        case 'providerConfigure':
          response = await this.providerConfigure((request.payload as { options?: ConfigureProviderOptions }).options) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'providerAdd':
          response = await this.providerAdd((request.payload as { options?: AddProviderOptions }).options) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'providerSet':
          response = await this.providerSet((request.payload as { options?: SetProviderOptions }).options) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'providerList':
          response = await this.providerList((request.payload as { options?: ProviderListOptions }).options) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'providerModels':
          response = await this.providerModels((request.payload as { options: ProviderModelsOptions }).options) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'providerModelsRefresh':
          response = await this.providerModelsRefresh((request.payload as { options: RefreshProviderModelsOptions }).options) as AiTeamCommandResponseMap[TCommand];
          break;
        case 'testConnection':
          response = await this.testConnection((request.payload as { options?: TestConnectionOptions }).options) as AiTeamCommandResponseMap[TCommand];
          break;
        default:
          throw new Error(`Unknown command '${String(request.command)}'`);
      }

      context.emit?.({
        kind: 'status',
        phase: 'completed',
        message: `Completed command '${request.command}'`,
      });
      writeBackendDebugLog(this.workspaceRoot, {
        source: 'invoke',
        phase: 'completed',
        command: request.command,
        requestId: request.requestId,
      });

      return response;
    };

    try {
      return context.emit
        ? await STDOUT_CAPTURE_SCOPE.run(true, invokeCore)
        : await invokeCore();
    } catch (error) {
      const serviceError = toServiceDomainError(error, `Command '${request.command}' failed.`);
      writeBackendDebugLog(this.workspaceRoot, {
        source: 'invoke',
        phase: 'error',
        command: request.command,
        requestId: request.requestId,
        error: {
          message: serviceError.message,
          code: serviceError.code,
          details: serviceError.details,
        },
      });
      emitWithConsole?.({
        kind: 'log',
        level: 'error',
        message: serviceError.message,
      });
      throw serviceError;
    } finally {
      if (context.emit) {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
      }
    }
  }

  async *stream<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context: MediatorContext = {},
  ): AsyncIterable<MediatorEvent<TCommand>> {
    const timestamp = () => new Date().toISOString();
    const runtimeQueue: MediatorRuntimeEvent[] = [];
    let runtimeWaiter: (() => void) | undefined;

    const emitRuntimeEvent = (event: MediatorRuntimeEvent) => {
      writeBackendDebugLog(this.workspaceRoot, {
        source: 'runtime',
        command: request.command,
        requestId: request.requestId,
        event,
      });
      context.logger?.({
        channel: 'runtime',
        event,
      });
      runtimeQueue.push(event);
      if (runtimeWaiter) {
        runtimeWaiter();
        runtimeWaiter = undefined;
      }
    };

    const toStreamEvent = (event: MediatorEvent<TCommand>): MediatorEvent<TCommand> => {
      writeBackendDebugLog(this.workspaceRoot, {
        source: 'stream',
        command: request.command,
        requestId: request.requestId,
        event,
      });
      context.logger?.({
        channel: 'stream',
        event,
      });
      return event;
    };

    if (context.signal?.aborted) {
      yield {
        requestId: request.requestId,
        command: request.command,
        kind: 'aborted',
        timestamp: timestamp(),
      };
      return;
    }

    yield {
      requestId: request.requestId,
      command: request.command,
      kind: 'started',
      timestamp: timestamp(),
    };

    let data: AiTeamCommandResponseMap[TCommand] | undefined;
    let invokeError: unknown;
    let invokeSettled = false;

    this.invoke(request, {
      ...context,
      emit: emitRuntimeEvent,
    })
      .then(result => {
        data = result;
      })
      .catch(error => {
        invokeError = error;
      })
      .finally(() => {
        invokeSettled = true;
        if (runtimeWaiter) {
          runtimeWaiter();
          runtimeWaiter = undefined;
        }
      });

    while (!invokeSettled || runtimeQueue.length > 0) {
      if (context.signal?.aborted) {
        yield toStreamEvent({
          requestId: request.requestId,
          command: request.command,
          kind: 'aborted',
          timestamp: timestamp(),
        });
        return;
      }

      if (runtimeQueue.length === 0) {
        await new Promise<void>(resolve => {
          const signal = context.signal;

          const cleanup = () => {
            if (signal) {
              signal.removeEventListener('abort', onAbort);
            }
            if (runtimeWaiter === onRuntimeEvent) {
              runtimeWaiter = undefined;
            }
          };

          const onRuntimeEvent = () => {
            cleanup();
            resolve();
          };

          const onAbort = () => {
            cleanup();
            resolve();
          };

          runtimeWaiter = onRuntimeEvent;

          if (signal) {
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
        continue;
      }

      const runtimeEvent = runtimeQueue.shift() as MediatorRuntimeEvent;
      if (runtimeEvent.kind === 'status') {
        yield toStreamEvent({
          requestId: request.requestId,
          command: request.command,
          kind: 'status',
          timestamp: timestamp(),
          phase: runtimeEvent.phase,
          message: runtimeEvent.message,
        });
      }

      if (runtimeEvent.kind === 'progress') {
        yield toStreamEvent({
          requestId: request.requestId,
          command: request.command,
          kind: 'progress',
          timestamp: timestamp(),
          phase: runtimeEvent.phase,
          percent: runtimeEvent.percent,
          message: runtimeEvent.message,
        });
      }

      if (runtimeEvent.kind === 'log') {
        yield toStreamEvent({
          requestId: request.requestId,
          command: request.command,
          kind: 'log',
          timestamp: timestamp(),
          level: runtimeEvent.level,
          message: runtimeEvent.message || '',
        });
      }

      if (runtimeEvent.kind === 'token' && runtimeEvent.text !== undefined) {
        yield toStreamEvent({
          requestId: request.requestId,
          command: request.command,
          kind: 'token',
          timestamp: timestamp(),
          text: runtimeEvent.text,
        });
      }

      if (runtimeEvent.kind === 'tool' && runtimeEvent.toolName) {
        yield toStreamEvent({
          requestId: request.requestId,
          command: request.command,
          kind: 'tool',
          timestamp: timestamp(),
          toolName: runtimeEvent.toolName,
          toolPhase: runtimeEvent.toolPhase,
          message: runtimeEvent.message,
        });
      }

      if (runtimeEvent.kind === 'question' && runtimeEvent.message) {
        yield toStreamEvent({
          requestId: request.requestId,
          command: request.command,
          kind: 'question',
          timestamp: timestamp(),
          questionType: runtimeEvent.questionType,
          message: runtimeEvent.message,
          choices: runtimeEvent.choices,
        });
      }

      if (runtimeEvent.kind === 'handoff' && runtimeEvent.fromAgentId && runtimeEvent.toAgentId) {
        yield toStreamEvent({
          requestId: request.requestId,
          command: request.command,
          kind: 'handoff',
          timestamp: timestamp(),
          fromAgentId: runtimeEvent.fromAgentId,
          fromAgentName: runtimeEvent.fromAgentName,
          fromSessionId: runtimeEvent.fromSessionId,
          toAgentId: runtimeEvent.toAgentId,
          toAgentName: runtimeEvent.toAgentName,
          toSessionId: runtimeEvent.toSessionId,
          handoffNote: runtimeEvent.handoffNote,
          message: runtimeEvent.message,
        });
      }
    }

    if (context.signal?.aborted) {
      yield toStreamEvent({
        requestId: request.requestId,
        command: request.command,
        kind: 'aborted',
        timestamp: timestamp(),
      });
      return;
    }

    if (invokeError) {
      const serviceError = toServiceDomainError(invokeError, `Command '${request.command}' failed.`);
      yield toStreamEvent({
        requestId: request.requestId,
        command: request.command,
        kind: 'error',
        timestamp: timestamp(),
        message: serviceError.message,
      });
      return;
    }

    try {
      yield toStreamEvent({
        requestId: request.requestId,
        command: request.command,
        kind: 'result',
        timestamp: timestamp(),
        data: data as AiTeamCommandResponseMap[TCommand],
      });

      yield toStreamEvent({
        requestId: request.requestId,
        command: request.command,
        kind: 'done',
        timestamp: timestamp(),
      });
    } catch (error) {
      yield toStreamEvent({
        requestId: request.requestId,
        command: request.command,
        kind: 'error',
        timestamp: timestamp(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async listEmployees(request: ListEmployeesRequest): Promise<Employee[]> {
    return listEmployeesCommand(this.workspaceRoot, request);
  }

  async resolveEmployees(query: string): Promise<Employee[]> {
    return resolveEmployeesCommand(this.workspaceRoot, query);
  }

  async searchAgents(request: SearchAgentsRequest): Promise<SearchAgentsResponse> {
    const results = await searchAgentsCommand(this.workspaceRoot, request);
    return {
      results,
      totalCount: results.length,
    };
  }

  async getTeamGraph(mode: ViewMode = 'hierarchy'): Promise<GraphData> {
    return getTeamGraphCommand(this.workspaceRoot, mode);
  }

  async getOrganizationGraph(): Promise<GraphData> {
    return getOrganizationGraphCommand(this.workspaceRoot);
  }

  async create(type: string, options: CreateOptions): Promise<void> {
    return createCommand(this.workspaceRoot, type, options);
  }

  async chat(employeeId: string | undefined, options: ChatOptions): Promise<void> {
    return chatCommand(this.workspaceRoot, employeeId, options);
  }

  async hire(options: HireOptions): Promise<void> {
    return hireCommand(this.workspaceRoot, options);
  }

  async fire(employeeQuery: string, options: FireOptions): Promise<void> {
    return fireCommand(this.workspaceRoot, employeeQuery, options);
  }

  async init(options: InitOptions): Promise<void> {
    return initCommand(this.workspaceRoot, options);
  }

  async hhRefresh(): Promise<void> {
    return hhRefreshCommand(this.workspaceRoot);
  }

  async providerConfigure(options: ConfigureProviderOptions = {}): Promise<void> {
    return providerConfigureCommand(this.workspaceRoot, options);
  }

  async providerAdd(options: AddProviderOptions = {}): Promise<void> {
    return providerAddCommand(this.workspaceRoot, options);
  }

  async providerSet(options: SetProviderOptions = {}): Promise<void> {
    return providerSetCommand(this.workspaceRoot, options);
  }

  async providerList(options: ProviderListOptions = {}): Promise<void> {
    return providerListCommand(this.workspaceRoot, options);
  }

  async providerModels(options: ProviderModelsOptions): Promise<void> {
    return providerModelsCommand(this.workspaceRoot, options);
  }

  async providerModelsRefresh(options: RefreshProviderModelsOptions): Promise<void> {
    return providerModelsRefreshCommand(this.workspaceRoot, options);
  }

  async testConnection(options: TestConnectionOptions = {}): Promise<void> {
    return testConnectionCommand(this.workspaceRoot, options);
  }
}

export function createAiTeamService(workspaceRoot: string): AiTeamService {
  return new CoreAiTeamService(workspaceRoot);
}

export type {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  AiTeamMediator,
  AiTeamService,
  ChatOptions,
  AddProviderOptions,
  ConfigureProviderOptions,
  CreateAgentSetupInput,
  CreateOptions,
  CreateSetupInput,
  CreateSkillSetupInput,
  Employee,
  FireOptions,
  HireOptions,
  InitOptions,
  ListEmployeesRequest,
  MediatorContext,
  MediatorEvent,
  MediatorRuntimeEvent,
  MediatorRequest,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionRequest,
  QuestionSelectChoice,
  QuestionSelectRequest,
  QuestionWorkflowMetadata,
  ProviderSetupInput,
  ProviderListOptions,
  SetProviderOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  SearchAgentsRequest,
  SearchAgentsResponse,
  WorkflowFrame,
  WorkflowStateSnapshot,
  TestConnectionOptions,
};

export { ServiceDomainError, AmbiguousAgentQueryError, type ServiceErrorCode, type ServiceErrorInputRequest } from './errors.js';
export { MissingUserInputError } from './utils/user-env.js';
export { SessionManager } from './session-manager.js';
export { TaskManager, type TaskFilter } from './task-manager.js';
export { resolveAgentForOperation, resolveAgentSafe } from './utils/agent-resolution.js';
export { findWorkspaceRoot } from './utils/workspace.js';
export { getSystemInfo, type SystemInfo } from './utils/system-info.js';
export {
  getFileTreeCommand,
  allowPathCommand,
  disallowPathCommand,
  agentAllowPathCommand,
  agentDisallowPathCommand,
  type AgentPathResult,
} from './commands/file-tree.js';

export { generateIntroduction } from './orchestrator/introduction.js';

// Storage abstraction layer
export {
  type IMessageStorage,
  type MessageFilter,
  type SessionFilter,
  type StorageStats,
  type MessageInsertResult,
  type MessageStorageFactory,
  SqliteMessageStorage,
  SqliteConnection,
  MigrationManager,
  createSqliteStorage,
} from './storage/index.js';
export { ProposalStore, type StoredProposal, type StoredProposalFile } from './storage/proposal-store.js';
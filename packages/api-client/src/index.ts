import { GraphData, ViewMode } from '@ai-team/core';
import {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  AiTeamMediator,
  MediatorContext,
  MediatorEvent,
  MediatorRuntimeEvent,
  MediatorRequest,
  QuestionChecklistRequest,
  QuestionAnswerValue,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionWorkflowMetadata,
  QuestionSelectChoice,
  QuestionSelectRequest,
  ChatOptions,
  AddProviderOptions,
  ConfigureProviderOptions,
  SetProviderOptions,
  CreateAgentSetupInput,
  Employee,
  AiTeamService,
  CreateOptions,
  CreateSetupInput,
  CreateSkillSetupInput,
  createAiTeamService,
  FireOptions,
  HireOptions,
  InitOptions,
  ListEmployeesRequest,
  ProviderSetupInput,
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  WorkflowFrame,
  WorkflowStateSnapshot,
  type ServiceErrorCode,
  type ServiceErrorInputRequest,
  TestConnectionOptions,
} from '@ai-team/service';

export interface AiTeamClient {
  invoke<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext,
  ): Promise<AiTeamCommandResponseMap[TCommand]>;
  stream<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext,
  ): AsyncIterable<MediatorEvent<TCommand>>;
  listEmployees(request: ListEmployeesRequest): Promise<Employee[]>;
  resolveEmployees(query: string): Promise<Employee[]>;
  getTeamGraph(mode?: ViewMode): Promise<GraphData>;
  getOrganizationGraph(): Promise<GraphData>;
  create(type: string, options: CreateOptions): Promise<void>;
  chat(employeeId: string | undefined, options: ChatOptions): Promise<void>;
  hire(options: HireOptions): Promise<void>;
  fire(employeeQuery: string, options: FireOptions): Promise<void>;
  init(options: InitOptions): Promise<void>;
  hhRefresh(): Promise<void>;
  providerConfigure(options?: ConfigureProviderOptions): Promise<void>;
  providerAdd(options?: AddProviderOptions): Promise<void>;
  providerSet(options?: SetProviderOptions): Promise<void>;
  providerList(options?: ProviderListOptions): Promise<void>;
  providerModels(options: ProviderModelsOptions): Promise<void>;
  providerModelsRefresh(options: RefreshProviderModelsOptions): Promise<void>;
  testConnection(options?: TestConnectionOptions): Promise<void>;
}

class InProcessAiTeamClient implements AiTeamClient {
  constructor(private readonly service: AiTeamService) {}

  async invoke<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context: MediatorContext = {},
  ): Promise<AiTeamCommandResponseMap[TCommand]> {
    return this.service.invoke(request, context);
  }

  stream<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context: MediatorContext = {},
  ): AsyncIterable<MediatorEvent<TCommand>> {
    return this.service.stream(request, context);
  }

  async listEmployees(request: ListEmployeesRequest): Promise<Employee[]> {
    return this.service.listEmployees(request);
  }

  async resolveEmployees(query: string): Promise<Employee[]> {
    return this.service.resolveEmployees(query);
  }

  async getTeamGraph(mode?: ViewMode): Promise<GraphData> {
    return this.service.getTeamGraph(mode);
  }

  async getOrganizationGraph(): Promise<GraphData> {
    return this.service.getOrganizationGraph();
  }

  async create(type: string, options: CreateOptions): Promise<void> {
    return this.service.create(type, options);
  }

  async chat(employeeId: string | undefined, options: ChatOptions): Promise<void> {
    return this.service.chat(employeeId, options);
  }

  async hire(options: HireOptions): Promise<void> {
    return this.service.hire(options);
  }

  async fire(employeeQuery: string, options: FireOptions): Promise<void> {
    return this.service.fire(employeeQuery, options);
  }

  async init(options: InitOptions): Promise<void> {
    return this.service.init(options);
  }

  async hhRefresh(): Promise<void> {
    return this.service.hhRefresh();
  }

  async providerConfigure(options: ConfigureProviderOptions = {}): Promise<void> {
    return this.service.providerConfigure(options);
  }

  async providerAdd(options: AddProviderOptions = {}): Promise<void> {
    return this.service.providerAdd(options);
  }

  async providerSet(options: SetProviderOptions = {}): Promise<void> {
    return this.service.providerSet(options);
  }

  async providerList(options: ProviderListOptions = {}): Promise<void> {
    return this.service.providerList(options);
  }

  async providerModels(options: ProviderModelsOptions): Promise<void> {
    return this.service.providerModels(options);
  }

  async providerModelsRefresh(options: RefreshProviderModelsOptions): Promise<void> {
    return this.service.providerModelsRefresh(options);
  }

  async testConnection(options: TestConnectionOptions = {}): Promise<void> {
    return this.service.testConnection(options);
  }
}

export function createInProcessAiTeamClient(service: AiTeamService): AiTeamClient {
  return new InProcessAiTeamClient(service);
}

export function createLocalAiTeamClient(workspaceRoot: string): AiTeamClient {
  const service = createAiTeamService(workspaceRoot);
  return createInProcessAiTeamClient(service);
}

export type {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  AiTeamMediator,
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
  MediatorContext,
  MediatorEvent,
  MediatorRuntimeEvent,
  MediatorRequest,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionWorkflowMetadata,
  QuestionSelectChoice,
  QuestionSelectRequest,
  ProviderSetupInput,
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  WorkflowFrame,
  WorkflowStateSnapshot,
  ServiceErrorCode,
  ServiceErrorInputRequest,
  TestConnectionOptions,
};

export {
  CLI_COMMAND_REGISTRY,
  IN_CHAT_COMMAND_ALIASES,
  IN_CHAT_COMMAND_REGISTRY,
  getCliCommandMetadata,
  getLlmCallableCliCommands,
  ServiceDomainError,
  MissingUserInputError,
} from '@ai-team/service';
import type {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  MediatorContext,
  MediatorEvent,
  MediatorRequest,
  ChatOptions,
  AddProviderOptions,
  ConfigureProviderOptions,
  SetProviderOptions,
  Employee,
  CreateOptions,
  FireOptions,
  HireOptions,
  InitOptions,
  ListEmployeesRequest,
  SearchAgentsRequest,
  SearchAgentsResponse,
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  TestConnectionOptions,
} from '@ai-team/service';
import type { AgentStatus, ContextLevel, GraphData, RoleType, ViewMode } from '@ai-team/core';
import { streamViaWebSocket } from './websocket.js';

function getFallbackQuestionAnswer(question: any): any {
  if (question?.kind === 'confirm') {
    return false;
  }
  if (question?.kind === 'checklist') {
    return [];
  }
  if (question?.kind === 'select') {
    return question?.choices?.[0]?.value ?? '';
  }
  return '';
}

export interface HttpClientConfig {
  baseUrl: string;
  wsUrl?: string;
}

export interface AiTeamHttpClient {
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
  searchAgents(request: SearchAgentsRequest): Promise<SearchAgentsResponse>;
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

class HttpAiTeamClient implements AiTeamHttpClient {
  private readonly baseUrl: string;
  private readonly wsUrl: string;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.wsUrl = config.wsUrl || this.baseUrl.replace(/^http/, 'ws');
  }

  async invoke<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext,
  ): Promise<AiTeamCommandResponseMap[TCommand]> {
    const response = await fetch(`${this.baseUrl}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, context }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  async *stream<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext,
  ): AsyncIterable<MediatorEvent<TCommand>> {
    // For chat commands, use WebSocket
    if (request.command === 'chat') {
      const payload = request.payload as any;
      const agentId = payload.employeeId;
      const message = payload.options?.message || '';

      const onQuestion = async (question: any): Promise<any> => {
        if (!context) {
          return getFallbackQuestionAnswer(question);
        }

        if (question.kind === 'input' && context.questionInput) {
          return context.questionInput(question);
        }
        if (question.kind === 'confirm' && context.questionConfirm) {
          return context.questionConfirm(question);
        }
        if (question.kind === 'select' && context.questionSelect) {
          return context.questionSelect(question);
        }
        if (question.kind === 'password' && context.questionPassword) {
          return context.questionPassword(question);
        }
        if (question.kind === 'checklist' && context.questionChecklist) {
          return context.questionChecklist(question);
        }

        return getFallbackQuestionAnswer(question);
      };

      yield* streamViaWebSocket<TCommand>(agentId, message, {
        url: this.wsUrl,
        onQuestion,
        disableQuestions: true,
        signal: context?.signal,
        sessionId: payload.options?.sessionId,
        messageOptions: payload.options,
      });
    } else {
      // For other commands, fall back to HTTP polling or throw
      throw new Error(`Streaming not supported for command: ${request.command}`);
    }
  }

  async listEmployees(request: ListEmployeesRequest): Promise<Employee[]> {
    const response = await fetch(`${this.baseUrl}/api/agents`);
    if (!response.ok) {
      throw new Error('Failed to list employees');
    }
    return response.json();
  }

  async resolveEmployees(query: string): Promise<Employee[]> {
    const response = await fetch(`${this.baseUrl}/api/agents/${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error('Failed to resolve employee');
    }
    const agent = await response.json();
    return [agent];
  }

  async searchAgents(request: SearchAgentsRequest): Promise<SearchAgentsResponse> {
    const params = new URLSearchParams();
    
    if (request.query) params.append('q', request.query);
    if (request.role) {
      const roles = Array.isArray(request.role) ? request.role : [request.role];
      roles.forEach((r: string) => params.append('role', r));
    }
    if (request.type) {
      const types = Array.isArray(request.type) ? request.type : [request.type];
      types.forEach((t: RoleType) => params.append('type', t));
    }
    if (request.status) {
      const statuses = Array.isArray(request.status) ? request.status : [request.status];
      statuses.forEach((s: AgentStatus) => params.append('status', s));
    }
    if (request.feature) {
      const features = Array.isArray(request.feature) ? request.feature : [request.feature];
      features.forEach((f: string) => params.append('feature', f));
    }
    if (request.specialization) {
      const specs = Array.isArray(request.specialization) ? request.specialization : [request.specialization];
      specs.forEach((s: string) => params.append('specialization', s));
    }
    if (request.tool) {
      const tools = Array.isArray(request.tool) ? request.tool : [request.tool];
      tools.forEach((t: string) => params.append('tool', t));
    }
    if (request.reportsTo) params.append('reportsTo', request.reportsTo);
    if (request.contextLevel) {
      const levels = Array.isArray(request.contextLevel) ? request.contextLevel : [request.contextLevel];
      levels.forEach((l: ContextLevel) => params.append('contextLevel', l));
    }

    const response = await fetch(`${this.baseUrl}/api/agents/search?${params.toString()}`);
    if (!response.ok) {
      throw new Error('Failed to search agents');
    }
    return response.json();
  }

  async getTeamGraph(mode?: ViewMode): Promise<GraphData> {
    const modeParam = mode ? `?mode=${mode}` : '';
    const response = await fetch(`${this.baseUrl}/api/team/graph${modeParam}`);
    if (!response.ok) {
      throw new Error('Failed to get team graph');
    }
    return response.json();
  }

  async getOrganizationGraph(): Promise<GraphData> {
    return this.getTeamGraph('hierarchy');
  }

  async create(type: string, options: CreateOptions): Promise<void> {
    throw new Error('Create operation not supported via HTTP client');
  }

  async chat(employeeId: string | undefined, options: ChatOptions): Promise<void> {
    if (!employeeId) {
      throw new Error('Employee ID is required');
    }

    const response = await fetch(`${this.baseUrl}/api/chat/${employeeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: options.message }),
    });

    if (!response.ok) {
      throw new Error('Failed to send chat message');
    }
  }

  async hire(options: HireOptions): Promise<void> {
    throw new Error('Hire operation not supported via HTTP client');
  }

  async fire(employeeQuery: string, options: FireOptions): Promise<void> {
    throw new Error('Fire operation not supported via HTTP client');
  }

  async init(options: InitOptions): Promise<void> {
    throw new Error('Init operation not supported via HTTP client');
  }

  async hhRefresh(): Promise<void> {
    throw new Error('HH refresh not supported via HTTP client');
  }

  async providerConfigure(options?: ConfigureProviderOptions): Promise<void> {
    throw new Error('Provider operations not supported via HTTP client');
  }

  async providerAdd(options?: AddProviderOptions): Promise<void> {
    throw new Error('Provider operations not supported via HTTP client');
  }

  async providerSet(options?: SetProviderOptions): Promise<void> {
    throw new Error('Provider operations not supported via HTTP client');
  }

  async providerList(options?: ProviderListOptions): Promise<void> {
    throw new Error('Provider operations not supported via HTTP client');
  }

  async providerModels(options: ProviderModelsOptions): Promise<void> {
    throw new Error('Provider operations not supported via HTTP client');
  }

  async providerModelsRefresh(options: RefreshProviderModelsOptions): Promise<void> {
    throw new Error('Provider operations not supported via HTTP client');
  }

  async testConnection(options?: TestConnectionOptions): Promise<void> {
    throw new Error('Test connection not supported via HTTP client');
  }
}

export function createHttpAiTeamClient(config: HttpClientConfig): AiTeamHttpClient {
  return new HttpAiTeamClient(config);
}

// Re-export types that web UI needs
export type {
  Employee,
  ListEmployeesRequest,
  ChatOptions,
  MediatorEvent,
  MediatorRequest,
  AiTeamCommandName,
} from '@ai-team/service';

export type { GraphData, ViewMode, Agent } from '@ai-team/core';

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
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  TestConnectionOptions,
} from '@ai-team/service';
import type { GraphData, ViewMode } from '@ai-team/core';
import { streamViaWebSocket } from './websocket.js';

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

      yield* streamViaWebSocket<TCommand>(agentId, message, { url: this.wsUrl });
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

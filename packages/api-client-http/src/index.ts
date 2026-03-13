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
  SearchSkillsOptions,
  SearchSkillsResponse,
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  UpdateAgentSkillOptions,
  UpdateAgentSkillResponse,
  ListToolsOptions,
  ListToolsResponse,
  UpdateAgentToolOptions,
  UpdateAgentToolResponse,
  GetFilePatternsResponse,
  PathMode,
  UpdateAgentPathOptions,
  UpdateAgentPathResponse,
  UpdateGlobalPathOptions,
  UpdateGlobalPathResponse,
  TestConnectionOptions,
} from '@ai-team/service';
import type { AgentStatus, AgentConfig, AnnotatedFile, ContextLevel, GraphData, MarkdownSection, RoleType, ViewMode } from '@ai-team/core';
import type {
  IdeCommitEditResponse,
  IdeEditStatusResponse,
  IdeOpenDiffRequest,
  IdeOpenDiffResponse,
  IdeResetEditResponse,
  IdeRevertEditResponse,
  IdeSessionAckActionRequest,
  IdeSessionActionRequest,
  IdeUpdateEditRequest,
  IdeUpdateEditResponse,
} from '@ai-team/ide-interface';
import { streamViaWebSocket } from './websocket.js';

export interface GovernanceMutationOptions {
  requestedBy: string;
  approvedByUser: boolean;
}

function getFallbackQuestionAnswer(question: any): any {
  if (question?.kind === 'confirm') {
    return false;
  }
  if (question?.kind === 'form') {
    return {};
  }
  if (question?.kind === 'checklist' || question?.kind === 'multiselect') {
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

/** Response shape for GET /api/agents/:id/files */
export interface AgentFilesResponse {
  agent: string;
  readPatterns: string[];
  writePatterns: string[];
  createPatterns?: string[];
  deletePatterns?: string[];
  files: AnnotatedFile[];
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
  searchSkills(options?: SearchSkillsOptions): Promise<SearchSkillsResponse>;
  /** Get agent frontmatter (fuzzy query by id/name/role) */
  getAgentFrontmatter(query: string): Promise<Employee>;
  /** Partially update agent frontmatter fields (fuzzy query) */
  updateAgentFrontmatter(query: string, data: Partial<AgentConfig>): Promise<Employee>;
  /** Get agent markdown body parsed into sections (fuzzy query) */
  getAgentSections(query: string): Promise<MarkdownSection[]>;
  /** Update or create a markdown section by heading (fuzzy query) */
  updateAgentSection(query: string, heading: string, content: string): Promise<MarkdownSection[]>;
  /** Get raw markdown body (fuzzy query) */
  getAgentMarkdown(query: string): Promise<string>;
  /** Replace full markdown body (fuzzy query) */
  updateAgentMarkdown(query: string, markdown: string): Promise<Employee>;
  /** Get annotated file list with read/write permissions (fuzzy query) */
  getAgentFiles(query: string, options?: { depth?: number; all?: boolean }): Promise<AgentFilesResponse>;
  getFilePatterns(agentQuery?: string): Promise<GetFilePatternsResponse>;
  allowPath(options: UpdateGlobalPathOptions): Promise<UpdateGlobalPathResponse>;
  disallowPath(options: UpdateGlobalPathOptions): Promise<UpdateGlobalPathResponse>;
  allowAgentPath(options: UpdateAgentPathOptions): Promise<UpdateAgentPathResponse>;
  disallowAgentPath(options: UpdateAgentPathOptions): Promise<UpdateAgentPathResponse>;
  addSkill(options: UpdateAgentSkillOptions): Promise<UpdateAgentSkillResponse>;
  removeSkill(options: UpdateAgentSkillOptions): Promise<UpdateAgentSkillResponse>;
  listTools(options?: ListToolsOptions): Promise<ListToolsResponse>;
  allowTool(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse>;
  disallowTool(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse>;
  toolAllow(options: UpdateAgentToolOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentToolResponse>;
  toolDeny(options: UpdateAgentToolOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentToolResponse>;
  accessAllow(options: UpdateAgentPathOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentPathResponse>;
  accessDeny(options: UpdateAgentPathOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentPathResponse>;
  getTeamGraph(mode?: ViewMode): Promise<GraphData>;
  getOrganizationGraph(): Promise<GraphData>;
  /** Get the full handoff session thread for any session in the chain */
  getSessionThread(sessionId: string): Promise<SessionThread>;
  /** Get a single session; pass includeMessages=true to embed messages */
  getSession(sessionId: string, includeMessages?: boolean): Promise<ChatSession>;
  /** Get all messages for a session */
  getSessionMessages(sessionId: string): Promise<ChatMessage[]>;
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
  ideOpenDiff(request: IdeOpenDiffRequest): Promise<IdeOpenDiffResponse>;
  ideUpdateEdit(request: IdeUpdateEditRequest): Promise<IdeUpdateEditResponse>;
  ideCommitEdit(request: IdeSessionActionRequest): Promise<IdeCommitEditResponse>;
  ideKeepEdit(request: IdeSessionAckActionRequest): Promise<IdeCommitEditResponse>;
  ideRevertEdit(request: IdeSessionActionRequest): Promise<IdeRevertEditResponse>;
  ideUndoEdit(request: IdeSessionAckActionRequest): Promise<IdeRevertEditResponse>;
  ideResetEdit(request: IdeSessionActionRequest): Promise<IdeResetEditResponse>;
  ideEditStatus(sessionId: string): Promise<IdeEditStatusResponse>;
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
        if ((question.kind === 'checklist' || question.kind === 'multiselect') && context.questionChecklist) {
          return context.questionChecklist(question);
        }
        if (question.kind === 'form' && context.questionForm) {
          return context.questionForm(question);
        }

        return getFallbackQuestionAnswer(question);
      };

      yield* streamViaWebSocket<TCommand>(agentId, message, {
        url: this.wsUrl,
        onQuestion,
        disableQuestions: false,
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

  // ---- Agent detail endpoints (all fuzzy by id/name/role) ----

  async getAgentFrontmatter(query: string): Promise<Employee> {
    const response = await fetch(`${this.baseUrl}/api/agents/${encodeURIComponent(query)}/frontmatter`);
    if (!response.ok) {
      throw new Error(`Failed to get agent frontmatter for "${query}"`);
    }
    return response.json();
  }

  async updateAgentFrontmatter(query: string, data: Partial<AgentConfig>): Promise<Employee> {
    const response = await fetch(`${this.baseUrl}/api/agents/${encodeURIComponent(query)}/frontmatter`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`Failed to update agent frontmatter for "${query}"`);
    }
    return response.json();
  }

  async getAgentSections(query: string): Promise<MarkdownSection[]> {
    const response = await fetch(`${this.baseUrl}/api/agents/${encodeURIComponent(query)}/sections`);
    if (!response.ok) {
      throw new Error(`Failed to get agent sections for "${query}"`);
    }
    return response.json();
  }

  async updateAgentSection(query: string, heading: string, content: string): Promise<MarkdownSection[]> {
    const response = await fetch(`${this.baseUrl}/api/agents/${encodeURIComponent(query)}/sections/${encodeURIComponent(heading)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error(`Failed to update section "${heading}" for agent "${query}"`);
    }
    return response.json();
  }

  async getAgentMarkdown(query: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/agents/${encodeURIComponent(query)}/markdown`);
    if (!response.ok) {
      throw new Error(`Failed to get agent markdown for "${query}"`);
    }
    return response.text();
  }

  async updateAgentMarkdown(query: string, markdown: string): Promise<Employee> {
    const response = await fetch(`${this.baseUrl}/api/agents/${encodeURIComponent(query)}/markdown`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    if (!response.ok) {
      throw new Error(`Failed to update agent markdown for "${query}"`);
    }
    return response.json();
  }

  async getAgentFiles(query: string, options?: { depth?: number; all?: boolean }): Promise<AgentFilesResponse> {
    const params = new URLSearchParams();
    if (options?.depth != null) params.append('depth', String(options.depth));
    if (options?.all) params.append('all', 'true');
    const qs = params.toString();
    const baseUrl = `${this.baseUrl}/api/agents/${encodeURIComponent(query)}/files`;
    const url = qs ? `${baseUrl}?${qs}` : baseUrl;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get agent files for "${query}"`);
    }
    return response.json();
  }

  async getFilePatterns(agentQuery?: string): Promise<GetFilePatternsResponse> {
    const params = new URLSearchParams();
    if (agentQuery) {
      params.set('agent', agentQuery);
    }
    const query = params.toString();
    const url = query
      ? `${this.baseUrl}/api/files/patterns?${query}`
      : `${this.baseUrl}/api/files/patterns`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to get file patterns');
    }
    return response.json();
  }

  async allowPath(options: UpdateGlobalPathOptions): Promise<UpdateGlobalPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const response = await fetch(`${this.baseUrl}/api/files/allow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: options.path, mode }),
    });
    if (!response.ok) {
      throw new Error('Failed to allow global path');
    }
    return response.json();
  }

  async disallowPath(options: UpdateGlobalPathOptions): Promise<UpdateGlobalPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const response = await fetch(`${this.baseUrl}/api/files/allow`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: options.path, mode }),
    });
    if (!response.ok) {
      throw new Error('Failed to disallow global path');
    }
    return response.json();
  }

  async allowAgentPath(options: UpdateAgentPathOptions): Promise<UpdateAgentPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const response = await fetch(`${this.baseUrl}/api/files/agents/${encodeURIComponent(options.agent)}/allow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: options.path, mode }),
    });
    if (!response.ok) {
      throw new Error('Failed to allow agent path');
    }
    return response.json();
  }

  async disallowAgentPath(options: UpdateAgentPathOptions): Promise<UpdateAgentPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const response = await fetch(`${this.baseUrl}/api/files/agents/${encodeURIComponent(options.agent)}/allow`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: options.path, mode }),
    });
    if (!response.ok) {
      throw new Error('Failed to disallow agent path');
    }
    return response.json();
  }

  async accessAllow(options: UpdateAgentPathOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const response = await fetch(`${this.baseUrl}/api/files/agents/${encodeURIComponent(options.agent)}/access_allow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: options.path,
        mode,
        requestedBy: governance.requestedBy,
        approvedByUser: governance.approvedByUser,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to allow governed agent path');
    }
    return response.json();
  }

  async accessDeny(options: UpdateAgentPathOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const response = await fetch(`${this.baseUrl}/api/files/agents/${encodeURIComponent(options.agent)}/access_deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: options.path,
        mode,
        requestedBy: governance.requestedBy,
        approvedByUser: governance.approvedByUser,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to deny governed agent path');
    }
    return response.json();
  }

  async listTools(options: ListToolsOptions = {}): Promise<ListToolsResponse> {
    const params = new URLSearchParams();
    if (options.agent) {
      params.set('agent', options.agent);
    }
    const queryString = params.toString();
    const baseUrl = `${this.baseUrl}/api/tools`;
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to list tools');
    }
    return response.json();
  }

  async allowTool(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse> {
    const response = await fetch(`${this.baseUrl}/api/tools/allow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });

    if (response.ok) {
      return response.json();
    }

    // Backward compatibility fallback for older servers
    if (response.status !== 404) {
      throw new Error('Failed to allow tool');
    }

    const frontmatter = await this.getAgentFrontmatter(options.agent);
    const currentTools = frontmatter.tools ?? [];
    const changed = !currentTools.includes(options.tool);
    const nextTools = changed
      ? [...currentTools, options.tool].sort((a, b) => a.localeCompare(b))
      : [...currentTools];

    const updated = changed
      ? await this.updateAgentFrontmatter(frontmatter.id, { tools: nextTools })
      : frontmatter;

    return {
      agent: { id: updated.id, name: updated.name, role: updated.role },
      tool: options.tool,
      tools: updated.tools ?? nextTools,
      changed,
    };
  }

  async disallowTool(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse> {
    const response = await fetch(`${this.baseUrl}/api/tools/disallow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });

    if (response.ok) {
      return response.json();
    }

    // Backward compatibility fallback for older servers
    if (response.status !== 404) {
      throw new Error('Failed to disallow tool');
    }

    const frontmatter = await this.getAgentFrontmatter(options.agent);
    const currentTools = frontmatter.tools ?? [];
    const nextTools = currentTools.filter(tool => tool !== options.tool);
    const changed = nextTools.length !== currentTools.length;

    const updated = changed
      ? await this.updateAgentFrontmatter(frontmatter.id, { tools: nextTools })
      : frontmatter;

    return {
      agent: { id: updated.id, name: updated.name, role: updated.role },
      tool: options.tool,
      tools: updated.tools ?? nextTools,
      changed,
    };
  }

  async toolAllow(options: UpdateAgentToolOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentToolResponse> {
    const response = await fetch(`${this.baseUrl}/api/tools/tool_allow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...options,
        requestedBy: governance.requestedBy,
        approvedByUser: governance.approvedByUser,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to allow governed tool');
    }

    return response.json();
  }

  async toolDeny(options: UpdateAgentToolOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentToolResponse> {
    const response = await fetch(`${this.baseUrl}/api/tools/tool_deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...options,
        requestedBy: governance.requestedBy,
        approvedByUser: governance.approvedByUser,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to deny governed tool');
    }

    return response.json();
  }

  async addSkill(options: UpdateAgentSkillOptions): Promise<UpdateAgentSkillResponse> {
    const response = await fetch(`${this.baseUrl}/api/skills/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      throw new Error('Failed to add skill');
    }

    return response.json();
  }

  async removeSkill(options: UpdateAgentSkillOptions): Promise<UpdateAgentSkillResponse> {
    const response = await fetch(`${this.baseUrl}/api/skills/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      throw new Error('Failed to remove skill');
    }

    return response.json();
  }

  async searchSkills(options: SearchSkillsOptions = {}): Promise<SearchSkillsResponse> {
    const params = new URLSearchParams();
    if (options.query) params.append('q', options.query);
    if (options.agent) params.append('agent', options.agent);

    const queryString = params.toString();
    const baseUrl = `${this.baseUrl}/api/skills`;
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to search skills');
    }
    return response.json();
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

  async getSessionThread(sessionId: string): Promise<SessionThread> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/thread`);
    if (!response.ok) {
      throw new Error(`Failed to get session thread for "${sessionId}"`);
    }
    return response.json();
  }

  async getSession(sessionId: string, includeMessages = false): Promise<ChatSession> {
    const qs = includeMessages ? '?includeMessages=true' : '';
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}${qs}`);
    if (!response.ok) {
      throw new Error(`Failed to get session "${sessionId}"`);
    }
    return response.json();
  }

  async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`);
    if (!response.ok) {
      throw new Error(`Failed to get messages for session "${sessionId}"`);
    }
    return response.json();
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

  async ideOpenDiff(request: IdeOpenDiffRequest): Promise<IdeOpenDiffResponse> {
    const response = await fetch(`${this.baseUrl}/api/ide/v1/edit/open-diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error('Failed to open IDE edit diff session');
    }
    return response.json();
  }

  async ideUpdateEdit(request: IdeUpdateEditRequest): Promise<IdeUpdateEditResponse> {
    const response = await fetch(`${this.baseUrl}/api/ide/v1/edit/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error('Failed to update IDE edit session');
    }
    return response.json();
  }

  async ideCommitEdit(request: IdeSessionActionRequest): Promise<IdeCommitEditResponse> {
    const response = await fetch(`${this.baseUrl}/api/ide/v1/edit/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error('Failed to commit IDE edit session');
    }
    return response.json();
  }

  async ideKeepEdit(request: IdeSessionAckActionRequest): Promise<IdeCommitEditResponse> {
    const response = await fetch(`${this.baseUrl}/api/ide/v1/edit/keep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error('Failed to keep IDE edit session');
    }
    return response.json();
  }

  async ideRevertEdit(request: IdeSessionActionRequest): Promise<IdeRevertEditResponse> {
    const response = await fetch(`${this.baseUrl}/api/ide/v1/edit/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error('Failed to revert IDE edit session');
    }
    return response.json();
  }

  async ideUndoEdit(request: IdeSessionAckActionRequest): Promise<IdeRevertEditResponse> {
    const response = await fetch(`${this.baseUrl}/api/ide/v1/edit/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error('Failed to undo IDE edit session');
    }
    return response.json();
  }

  async ideResetEdit(request: IdeSessionActionRequest): Promise<IdeResetEditResponse> {
    const response = await fetch(`${this.baseUrl}/api/ide/v1/edit/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error('Failed to reset IDE edit session');
    }
    return response.json();
  }

  async ideEditStatus(sessionId: string): Promise<IdeEditStatusResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/ide/v1/edit/status?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!response.ok) {
      throw new Error('Failed to fetch IDE edit session status');
    }
    return response.json();
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

export type { GraphData, ViewMode, Agent, AgentConfig, AnnotatedFile, MarkdownSection } from '@ai-team/core';
export type {
  IdeOpenDiffRequest,
  IdeOpenDiffResponse,
  IdeUpdateEditRequest,
  IdeUpdateEditResponse,
  IdeSessionActionRequest,
  IdeSessionAckActionRequest,
  IdeCommitEditResponse,
  IdeRevertEditResponse,
  IdeResetEditResponse,
  IdeEditStatusResponse,
} from '@ai-team/ide-interface';

// Inline browser-safe session types (mirrors packages/web/src/types.ts)
export interface ChatMessage {
  from: string;
  to?: string;
  isHuman?: boolean;
  content: string;
  timestamp: string;
  archived?: boolean;
  handoffType?: 'user-acknowledgment' | 'agent-briefing';
  targetAgentId?: string;
  handoffId?: string;
  handoffFromSessionId?: string;
  handoffToSessionId?: string;
}

export interface SessionActivatedTool {
  toolName: string;
  toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
  message?: string;
  toolResult?: {
    toolName: string;
    outcome: 'result' | 'error' | 'denied';
    result?: unknown;
    denial?: {
      kind: 'user-denied' | 'policy-denied' | 'execution-failed';
      reasonCode: string;
      message: string;
      blockedPaths?: string[];
      alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
      handoffRecommendation?: {
        possible: boolean;
        requiresUserApproval: true;
        contexts: Array<{ contextId: string; allowedPaths: string[] }>;
      };
    };
  };
  toolDenial?: {
    kind: 'user-denied' | 'policy-denied' | 'execution-failed';
    reasonCode: string;
    message: string;
    blockedPaths?: string[];
    alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
    handoffRecommendation?: {
      possible: boolean;
      requiresUserApproval: true;
      contexts: Array<{ contextId: string; allowedPaths: string[] }>;
    };
  };
  timestamp: string;
}

export interface ChatSession {
  id: string;
  agentId: string;
  agentIds?: string[];
  developerId: string;
  title?: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  artifacts: string[];
  allowedFiles: string[];
  notes?: string;
  activatedTools?: SessionActivatedTool[];
  previousSessionId?: string;
  mergedFromSessionIds?: string[] | null;
  messages?: ChatMessage[];
}

export interface HandoffEdge {
  handoffId: string;
  fromSessionId: string | null;
  toSessionId: string | null;
  fromAgentIds: string[];
  toAgentIds: string[];
}

export interface SessionNode {
  sessionId: string;
  agentIds: string[];
  agentNames: string[];
  developerId: string | null;
  title: string | null;
  startedAt: string;
  lastActivityAt: string;
  previousSessionId: string | null;
  mergedFromSessionIds: string[] | null;
  messageCount: number;
  messages: ChatMessage[];
}

export interface SessionThread {
  rootSessionId: string;
  currentSessionId: string;
  depth: number;
  handoffs: HandoffEdge[];
  sessions: SessionNode[];
}

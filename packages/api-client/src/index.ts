import {
  GraphData,
  ViewMode,
  Agent,
  AgentConfig,
  AnnotatedFile,
  MarkdownSection,
  AgentManager,
  ContextManager,
  createAccessEngine,
  listCachedWorkspaceFiles,
  loadAgentAccessPatterns,
  loadTeamConfig,
  parseMarkdownSections,
  replaceOrAppendMarkdownSection,
} from '@ai-team/core';
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
  findWorkspaceRoot,
  FireOptions,
  HireOptions,
  InitOptions,
  ListEmployeesRequest,
  SearchSkillsOptions,
  SearchSkillsResponse,
  ProviderSetupInput,
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
  AccessRight,
  WhoHasAccessOptions,
  WhoHasAccessResponse,
  DoIHaveAccessOptions,
  DoIHaveAccessResponse,
  WorkflowFrame,
  WorkflowStateSnapshot,
  type ServiceErrorCode,
  type ServiceErrorInputRequest,
  TestConnectionOptions,
  allowPathCommand,
  disallowPathCommand,
  agentAllowPathCommand,
  agentDisallowPathCommand,
} from '@ai-team/service';
import { SearchAgentsRequest, SearchAgentsResponse } from '@ai-team/service/src/contracts';

export interface GovernanceMutationOptions {
  requestedBy: string;
  approvedByUser: boolean;
}

/** Response shape for agent file-tree listing with read/write annotations */
export interface AgentFilesResponse {
  agent: string;
  readPatterns: string[];
  writePatterns: string[];
  createPatterns?: string[];
  deletePatterns?: string[];
  files: AnnotatedFile[];
}

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
  searchAgents(request: SearchAgentsRequest): Promise<SearchAgentsResponse>;
  searchSkills(options?: SearchSkillsOptions): Promise<SearchSkillsResponse>;
  /** Get agent frontmatter (fuzzy query by id/name/role) */
  getAgentFrontmatter(query: string): Promise<Agent>;
  /** Partially update agent frontmatter fields (fuzzy query) */
  updateAgentFrontmatter(query: string, data: Partial<AgentConfig>): Promise<Agent>;
  /** Get agent markdown body parsed into sections (fuzzy query) */
  getAgentSections(query: string): Promise<MarkdownSection[]>;
  /** Update or create a markdown section by heading (fuzzy query) */
  updateAgentSection(query: string, heading: string, content: string): Promise<MarkdownSection[]>;
  /** Get raw markdown body (fuzzy query) */
  getAgentMarkdown(query: string): Promise<string>;
  /** Replace full markdown body (fuzzy query) */
  updateAgentMarkdown(query: string, markdown: string): Promise<Agent>;
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
  whoHasAccess(options: WhoHasAccessOptions): Promise<WhoHasAccessResponse>;
  doIHaveAccess(options: DoIHaveAccessOptions): Promise<DoIHaveAccessResponse>;
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

  async searchAgents(request: SearchAgentsRequest): Promise<SearchAgentsResponse> {
    return this.service.searchAgents(request);
  }

  async searchSkills(options: SearchSkillsOptions = {}): Promise<SearchSkillsResponse> {
    return this.service.searchSkills(options);
  }

  async getAgentFrontmatter(query: string): Promise<Agent> {
    const agents = await this.service.resolveEmployees(query);
    if (agents.length === 0) throw new Error(`No agent matching "${query}"`);
    return agents[0] as unknown as Agent;
  }

  async updateAgentFrontmatter(query: string, data: Partial<AgentConfig>): Promise<Agent> {
    const agents = await this.service.resolveEmployees(query);
    if (agents.length === 0) throw new Error(`No agent matching "${query}"`);
    const agent = agents[0] as unknown as Agent;
    const mgr = new AgentManager(this.service.workspaceRoot);
    await mgr.initialize();
    return mgr.updateAgent(agent.id, data);
  }

  async getAgentSections(query: string): Promise<MarkdownSection[]> {
    const agent = await this.getAgentFrontmatter(query);
    return parseMarkdownSections(agent.markdown || '');
  }

  async updateAgentSection(query: string, heading: string, content: string): Promise<MarkdownSection[]> {
    const agent = await this.getAgentFrontmatter(query);
    const newMd = replaceOrAppendMarkdownSection(agent.markdown || '', heading, content);
    const mgr = new AgentManager(this.service.workspaceRoot);
    await mgr.initialize();
    const updated = await mgr.updateAgent(agent.id, { markdown: newMd });
    return parseMarkdownSections(updated.markdown || '');
  }

  async getAgentMarkdown(query: string): Promise<string> {
    const agent = await this.getAgentFrontmatter(query);
    return agent.markdown || '';
  }

  async updateAgentMarkdown(query: string, markdown: string): Promise<Agent> {
    const agent = await this.getAgentFrontmatter(query);
    const mgr = new AgentManager(this.service.workspaceRoot);
    await mgr.initialize();
    return mgr.updateAgent(agent.id, { markdown });
  }

  async getAgentFiles(query: string, options?: { depth?: number; all?: boolean }): Promise<AgentFilesResponse> {
    const agent = await this.getAgentFrontmatter(query);
    const ws = this.service.workspaceRoot;
    const config = await loadTeamConfig(ws);
    const manager = new AgentManager(ws);
    await manager.initialize();
    const engine = createAccessEngine({
      workspaceRoot: ws,
      fileTreeConfig: config?.fileTree,
      agents: manager.getAllAgents(),
    });
    const allowPaths = Array.from(new Set([
      ...(config?.fileTree?.readPaths ?? []),
      ...(config?.fileTree?.writePaths ?? []),
      ...(config?.fileTree?.createPaths ?? []),
      ...(config?.fileTree?.deletePaths ?? []),
    ]));
    const entries = await listCachedWorkspaceFiles(ws, {
      maxDepth: options?.depth ?? 6,
      allowPaths,
      filesOnly: true,
    });
    const allFiles = entries.map((entry) => entry.relativePath);
    const ctx = ContextManager.fromConfig(ws, config?.fileTree, engine);
    const annotated = ctx.getAnnotatedFiles(agent, allFiles);
    const files = options?.all ? annotated : annotated.filter(f => f.readable || f.writable);
    const accessPatterns = await loadAgentAccessPatterns(ws, agent.id);
    return {
      agent: agent.id,
      readPatterns: accessPatterns.read,
      writePatterns: accessPatterns.write,
      createPatterns: accessPatterns.create,
      deletePatterns: accessPatterns.delete,
      files,
    };
  }

  async getFilePatterns(agentQuery?: string): Promise<GetFilePatternsResponse> {
    const ws = this.service.workspaceRoot;
    const config = await loadTeamConfig(ws);
    const global = {
      allowPaths: Array.from(new Set([
        ...(config?.fileTree?.readPaths ?? []),
        ...(config?.fileTree?.writePaths ?? []),
        ...(config?.fileTree?.createPaths ?? []),
        ...(config?.fileTree?.deletePaths ?? []),
      ])),
      readPaths: config?.fileTree?.readPaths ?? [],
      writePaths: config?.fileTree?.writePaths ?? [],
      createPaths: config?.fileTree?.createPaths ?? [],
      deletePaths: config?.fileTree?.deletePaths ?? [],
    };

    if (!agentQuery) {
      return { global };
    }

    const agent = await this.getAgentFrontmatter(agentQuery);
    const patterns = await loadAgentAccessPatterns(ws, agent.id);

    return {
      global,
      agent: {
        id: agent.id,
        readPaths: patterns.read,
        writePaths: patterns.write,
        createPaths: patterns.create,
        deletePaths: patterns.delete,
      },
    };
  }

  async allowPath(options: UpdateGlobalPathOptions): Promise<UpdateGlobalPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const paths = await allowPathCommand(this.service.workspaceRoot, options.path, mode);
    return { mode, paths };
  }

  async disallowPath(options: UpdateGlobalPathOptions): Promise<UpdateGlobalPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const paths = await disallowPathCommand(this.service.workspaceRoot, options.path, mode);
    return { mode, paths };
  }

  async allowAgentPath(options: UpdateAgentPathOptions): Promise<UpdateAgentPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const result = await agentAllowPathCommand(this.service.workspaceRoot, options.agent, options.path, mode);
    return {
      agent: {
        id: result.agent.id,
        name: result.agent.name,
        role: result.agent.role,
      },
      mode,
      paths: result.paths,
    };
  }

  async disallowAgentPath(options: UpdateAgentPathOptions): Promise<UpdateAgentPathResponse> {
    const mode: PathMode = options.mode ?? 'read';
    const result = await agentDisallowPathCommand(this.service.workspaceRoot, options.agent, options.path, mode);
    return {
      agent: {
        id: result.agent.id,
        name: result.agent.name,
        role: result.agent.role,
      },
      mode,
      paths: result.paths,
    };
  }

  async accessAllow(options: UpdateAgentPathOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentPathResponse> {
    const governed = this.service as AiTeamService & {
      accessAllow: (options: UpdateAgentPathOptions, governance: GovernanceMutationOptions) => Promise<UpdateAgentPathResponse>;
    };
    return governed.accessAllow(options, governance);
  }

  async accessDeny(options: UpdateAgentPathOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentPathResponse> {
    const governed = this.service as AiTeamService & {
      accessDeny: (options: UpdateAgentPathOptions, governance: GovernanceMutationOptions) => Promise<UpdateAgentPathResponse>;
    };
    return governed.accessDeny(options, governance);
  }

  async addSkill(options: UpdateAgentSkillOptions): Promise<UpdateAgentSkillResponse> {
    return this.service.addSkill(options);
  }

  async removeSkill(options: UpdateAgentSkillOptions): Promise<UpdateAgentSkillResponse> {
    return this.service.removeSkill(options);
  }

  async listTools(options: ListToolsOptions = {}): Promise<ListToolsResponse> {
    return this.service.listTools(options);
  }

  async allowTool(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse> {
    return this.service.allowTool(options);
  }

  async disallowTool(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse> {
    return this.service.disallowTool(options);
  }

  async toolAllow(options: UpdateAgentToolOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentToolResponse> {
    const governed = this.service as AiTeamService & {
      toolAllow: (options: UpdateAgentToolOptions, governance: GovernanceMutationOptions) => Promise<UpdateAgentToolResponse>;
    };
    return governed.toolAllow(options, governance);
  }

  async toolDeny(options: UpdateAgentToolOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentToolResponse> {
    const governed = this.service as AiTeamService & {
      toolDeny: (options: UpdateAgentToolOptions, governance: GovernanceMutationOptions) => Promise<UpdateAgentToolResponse>;
    };
    return governed.toolDeny(options, governance);
  }

  async whoHasAccess(options: WhoHasAccessOptions): Promise<WhoHasAccessResponse> {
    return this.service.whoHasAccess(options);
  }

  async doIHaveAccess(options: DoIHaveAccessOptions): Promise<DoIHaveAccessResponse> {
    return this.service.doIHaveAccess(options);
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

export function createLocalAiTeamClient(workspaceRoot?: string): AiTeamClient {
  const resolvedWorkspaceRoot = workspaceRoot || findWorkspaceRoot();
  const service = createAiTeamService(resolvedWorkspaceRoot);
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
  SearchSkillsOptions,
  SearchSkillsResponse,
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
  ListToolsOptions,
  ListToolsResponse,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  UpdateAgentSkillOptions,
  UpdateAgentSkillResponse,
  UpdateAgentToolOptions,
  UpdateAgentToolResponse,
  AccessRight,
  WhoHasAccessOptions,
  WhoHasAccessResponse,
  DoIHaveAccessOptions,
  DoIHaveAccessResponse,
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
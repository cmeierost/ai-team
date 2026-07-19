import { createRestClient, RestClientError } from '@ts-http/core';
import type { RestClientOptions } from '@ts-http/core';
import { StreamingClient } from './streaming-client.js';
import type {
  InteractionRequest,
  QuestionHandlerMap,
  StreamEvent,
} from './contract/routers/streaming.js';
import { accessDesc, IAccessService } from './contract/routers/access.js';
import { agentsDesc, IAgentsService } from './contract/routers/agents.js';
import { artifactsDesc, IArtifactsService } from './contract/routers/artifacts.js';
import { chatDesc, IChatService } from './contract/routers/chat.js';
import { commandsDesc, ICommandsService } from './contract/routers/commands.js';
import { configDesc, IConfigService } from './contract/routers/config.js';
import { developerDesc, IDeveloperService } from './contract/routers/developer.js';
import { IPermissionService, permissionDesc } from './contract/routers/permissions.js';
import { ideDesc, IIdeService } from './contract/routers/ide.js';
import { contextDesc, IContextService } from './contract/routers/meta.js';
import { IPlanningService, planningDesc } from './contract/routers/planning.js';
import { ISessionsService, sessionsDesc } from './contract/routers/sessions.js';
import { ISkillsService, skillsDesc } from './contract/routers/skills.js';
import { ISystemService, systemDesc } from './contract/routers/system.js';
import { ITasksService, tasksDesc } from './contract/routers/tasks.js';
import { ITeamGraphService, teamDesc } from './contract/routers/team.js';
import { IToolsService, toolsDesc } from './contract/routers/tools.js';

export type { WebSocketStreamOptions } from './websocket.js';
export { streamViaWebSocket, summarizeNoteViaWebSocket } from './websocket.js';
export type { SummarizeNoteWebSocketOptions } from './websocket.js';

// ─── Error type ───────────────────────────────────────────────────────────────

export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    const msg =
      (body as any)?.error ??
      (body as any)?.message ??
      (typeof body === 'string' ? body : `HTTP ${status}`);
    super(msg);
    this.name = 'ApiHttpError';
  }
}

// ─── Client factory ───────────────────────────────────────────────────────────

export interface CreateAiTeamClientOptions {
  baseUrl: string;
  wsUrl?: string;
  restOptions?: RestClientOptions;
}

function makeRestClient<T>(desc: object, baseUrl: string, options?: RestClientOptions): T {
  const restOpts: RestClientOptions = {
    // Disable the default dateAdapter — it converts ISO timestamp strings to
    // Date objects at runtime, which breaks path-param serialisation because
    // encodeURIComponent(new Date()) produces a locale string, not an ISO string.
    adapters: [],
    ...options,
    onError: (error: RestClientError) => {
      const apiError = new ApiHttpError((error as any).status ?? 500, error.message);
      const suppressed = options?.onError?.(apiError, error);
      if (!suppressed) throw apiError;
    },
  };
  return createRestClient<T>(desc as any, baseUrl, restOpts);
}

export function createAiTeamClient({ baseUrl, wsUrl, restOptions }: CreateAiTeamClientOptions) {
  const wsBaseUrl = wsUrl ?? baseUrl.replace(/^http/, 'ws');
  const streaming = new StreamingClient(baseUrl, wsBaseUrl);

  const access = makeRestClient<IAccessService>(accessDesc, baseUrl, restOptions);
  const agents = makeRestClient<IAgentsService>(agentsDesc, baseUrl, restOptions);
  const artifacts = makeRestClient<IArtifactsService>(artifactsDesc, baseUrl, restOptions);
  const chat = makeRestClient<IChatService>(chatDesc, baseUrl, restOptions);
  const commands = makeRestClient<ICommandsService>(commandsDesc, baseUrl, restOptions);
  const config = makeRestClient<IConfigService>(configDesc, baseUrl, restOptions);
  const developer = makeRestClient<IDeveloperService>(developerDesc, baseUrl, restOptions);
  const files = makeRestClient<IPermissionService>(permissionDesc, baseUrl, restOptions);
  const ide = makeRestClient<IIdeService>(ideDesc, baseUrl, restOptions);
  const context = makeRestClient<IContextService>(contextDesc, baseUrl, restOptions);
  const sessions = makeRestClient<ISessionsService>(sessionsDesc, baseUrl, restOptions);
  const planning = makeRestClient<IPlanningService>(planningDesc, baseUrl, restOptions);
  const skills = makeRestClient<ISkillsService>(skillsDesc, baseUrl, restOptions);
  const system = makeRestClient<ISystemService>(systemDesc, baseUrl, restOptions);
  const tasks = makeRestClient<ITasksService>(tasksDesc, baseUrl, restOptions);
  const team = makeRestClient<ITeamGraphService>(teamDesc, baseUrl, restOptions);
  const tools = makeRestClient<IToolsService>(toolsDesc, baseUrl, restOptions);

  return {
    access,
    agents,
    artifacts,
    chat,
    commands,
    config,
    developer,
    files,
    ide,
    context,
    sessions,
    planning,
    skills,
    system,
    tasks,
    team,
    tools,
    stream<TCommand extends string = string>(
      request: InteractionRequest,
      ctx: QuestionHandlerMap
    ): AsyncIterable<StreamEvent<TCommand>> {
      return streaming.stream<TCommand>(request, ctx);
    },
  };
}

export type AiTeamHttpClient = ReturnType<typeof createAiTeamClient>;

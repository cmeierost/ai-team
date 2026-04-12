import { createRestClient, RestClientError } from '@ts-http/core';
import type { RestClientOptions } from '@ts-http/core';
import { StreamingClient } from './streaming-client.js';
import type {
  MediatorRequest,
  MediatorEvent,
  MediatorContext,
  AiTeamCommandName,
} from './contract/routers/streaming.js';
import { accessDesc } from './contract/routers/access.js';
import { agentsDesc } from './contract/routers/agents.js';
import { artifactsDesc } from './contract/routers/artifacts.js';
import { chatDesc } from './contract/routers/chat.js';
import { commandsDesc } from './contract/routers/commands.js';
import { configDesc } from './contract/routers/config.js';
import { developerDesc } from './contract/routers/developer.js';
import { permissionDesc } from './contract/routers/files.js';
import { ideDesc } from './contract/routers/ide.js';
import { contextDesc } from './contract/routers/meta.js';
import { sessionsDesc } from './contract/routers/sessions.js';
import { skillsDesc } from './contract/routers/skills.js';
import { systemDesc } from './contract/routers/system.js';
import { tasksDesc } from './contract/routers/tasks.js';
import { teamDesc } from './contract/routers/team.js';
import { toolsDesc } from './contract/routers/tools.js';

export type { WebSocketStreamOptions } from './websocket.js';
export { streamViaWebSocket } from './websocket.js';

// ─── Error type ───────────────────────────────────────────────────────────────

export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    const msg = (body as any)?.error ?? (body as any)?.message ?? `HTTP ${status}`;
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

  const access = makeRestClient<import('./contract/routers/access.js').IAccessService>(
    accessDesc,
    baseUrl,
    restOptions
  );
  const agents = makeRestClient<import('./contract/routers/agents.js').IAgentsService>(
    agentsDesc,
    baseUrl,
    restOptions
  );
  const artifacts = makeRestClient<import('./contract/routers/artifacts.js').IArtifactsService>(
    artifactsDesc,
    baseUrl,
    restOptions
  );
  const chat = makeRestClient<import('./contract/routers/chat.js').IChatService>(
    chatDesc,
    baseUrl,
    restOptions
  );
  const commands = makeRestClient<import('./contract/routers/commands.js').ICommandsService>(
    commandsDesc,
    baseUrl,
    restOptions
  );
  const config = makeRestClient<import('./contract/routers/config.js').IConfigService>(
    configDesc,
    baseUrl,
    restOptions
  );
  const developer = makeRestClient<import('./contract/routers/developer.js').IDeveloperService>(
    developerDesc,
    baseUrl,
    restOptions
  );
  const files = makeRestClient<import('./contract/routers/files.js').IPermissionService>(
    permissionDesc,
    baseUrl,
    restOptions
  );
  const ide = makeRestClient<import('./contract/routers/ide.js').IIdeService>(
    ideDesc,
    baseUrl,
    restOptions
  );
  const context = makeRestClient<import('./contract/routers/meta.js').IContextService>(
    contextDesc,
    baseUrl,
    restOptions
  );
  const sessions = makeRestClient<import('./contract/routers/sessions.js').ISessionsService>(
    sessionsDesc,
    baseUrl,
    restOptions
  );
  const skills = makeRestClient<import('./contract/routers/skills.js').ISkillsService>(
    skillsDesc,
    baseUrl,
    restOptions
  );
  const system = makeRestClient<import('./contract/routers/system.js').ISystemService>(
    systemDesc,
    baseUrl,
    restOptions
  );
  const tasks = makeRestClient<import('./contract/routers/tasks.js').ITasksService>(
    tasksDesc,
    baseUrl,
    restOptions
  );
  const team = makeRestClient<import('./contract/routers/team.js').ITeamGraphService>(
    teamDesc,
    baseUrl,
    restOptions
  );
  const tools = makeRestClient<import('./contract/routers/tools.js').IToolsService>(
    toolsDesc,
    baseUrl,
    restOptions
  );

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
    skills,
    system,
    tasks,
    team,
    tools,
    stream<TCommand extends AiTeamCommandName>(
      request: MediatorRequest<TCommand>,
      ctx?: MediatorContext
    ): AsyncIterable<MediatorEvent<TCommand>> {
      return streaming.streamInteraction<TCommand>(request, ctx);
    },
  };
}

export type AiTeamHttpClient = ReturnType<typeof createAiTeamClient>;

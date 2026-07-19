import { Token } from '@ai-team/core';
import type {
  IAccessService,
  IAgentsService,
  IArtifactsService,
  IChatService,
  ICommandsService,
  IConfigService,
  IContextService,
  IDeveloperService,
  IIdeService,
  IPlanningService,
  IPermissionService,
  ISessionsService,
  ISkillsService,
  ISystemService,
  ITasksService,
  ITeamGraphService,
  IToolsService,
} from './routers/index.js';

/**
 * API-contract service tokens (interface-first).
 *
 * Keep these scoped to HTTP/router contracts so container bootstrap can type
 * route service registrations without referencing concrete implementations.
 */
export const CONTRACT_SERVICE_TOKENS = {
  SystemService: new Token<ISystemService>('SystemService'),
  AgentsService: new Token<IAgentsService>('AgentsService'),
  TeamService: new Token<ITeamGraphService>('TeamService'),
  ChatService: new Token<IChatService>('ChatService'),
  SessionsService: new Token<ISessionsService>('SessionsService'),
  ArtifactsService: new Token<IArtifactsService>('ArtifactsService'),
  TasksService: new Token<ITasksService>('TasksService'),
  PlanningService: new Token<IPlanningService>('PlanningService'),
  DeveloperService: new Token<IDeveloperService>('DeveloperService'),
  FilesService: new Token<IPermissionService>('FilesService'),
  IdeService: new Token<IIdeService>('IdeService'),
  SkillsService: new Token<ISkillsService>('SkillsService'),
  ToolsService: new Token<IToolsService>('ToolsService'),
  ConfigService: new Token<IConfigService>('ConfigService'),
  MetaService: new Token<IContextService>('MetaService'),
  CommandsService: new Token<ICommandsService>('CommandsService'),
  AccessService: new Token<IAccessService>('AccessService'),
} as const;

export type ContractServiceTokens = typeof CONTRACT_SERVICE_TOKENS;

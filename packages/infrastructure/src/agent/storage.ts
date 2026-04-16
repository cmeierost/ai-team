/**
 * Compatibility facade for agent storage APIs.
 *
 * Keeps the existing function-based exports stable while delegating
 * implementation to concern-specific storage classes.
 */

import { PermFileRegistry } from 'fs-context';
import { AgentDocumentStorage } from './agent-document-storage.js';
import { ConfigurationStorage } from './configuration-storage.js';
import { EnvironmentStorage } from './environment-storage.js';
import { MarkdownSectionService } from './markdown-service.js';
import { WorkspaceDiscoveryStorage } from './WorkspaceDiscoveryStorage.js';
import { WorkspaceStorage } from './WorkspaceStorage.js';

const markdownSectionService = new MarkdownSectionService();
const workspaceStorage = new WorkspaceStorage();
const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();
const agentDocumentStorage = new AgentDocumentStorage(
  markdownSectionService,
  workspaceStorage,
  workspaceDiscoveryStorage
);
const configurationStorage = new ConfigurationStorage();
const environmentStorage = new EnvironmentStorage();

export const loadAgent = agentDocumentStorage.loadAgentAsync.bind(agentDocumentStorage);
export const saveAgent = agentDocumentStorage.saveAgentAsync.bind(agentDocumentStorage);
export const loadSkill = agentDocumentStorage.loadSkillAsync.bind(agentDocumentStorage);
export const saveSkill = agentDocumentStorage.saveSkillAsync.bind(agentDocumentStorage);
export const findAgentFiles =
  workspaceDiscoveryStorage.findAgentFilesAsync.bind(workspaceDiscoveryStorage);
export const findSkillFiles =
  workspaceDiscoveryStorage.findSkillFilesAsync.bind(workspaceDiscoveryStorage);
export const resolveAgentSkillFilePath =
  workspaceDiscoveryStorage.resolveAgentSkillFilePath.bind(workspaceDiscoveryStorage);
export const loadAgentSkillFile =
  agentDocumentStorage.loadAgentSkillFileAsync.bind(agentDocumentStorage);
export const findInstructionFiles =
  workspaceDiscoveryStorage.findInstructionFilesAsync.bind(workspaceDiscoveryStorage);
export const loadInstructionFile =
  agentDocumentStorage.loadInstructionFileAsync.bind(agentDocumentStorage);
export const loadAllInstructionFiles =
  agentDocumentStorage.loadAllInstructionFilesAsync.bind(agentDocumentStorage);
export const fileExists = workspaceStorage.fileExistsAsync.bind(workspaceStorage);
export const ensureAiTeamDirectory =
  workspaceStorage.ensureAiTeamDirectoryAsync.bind(workspaceStorage);
export const getAgentAccessFilePath = (workspaceRoot: string, agentId: string): string =>
  new PermFileRegistry(workspaceRoot).getPermFilePath(agentId);
export const loadAgentAccessPatterns = (workspaceRoot: string, agentId: string) =>
  new PermFileRegistry(workspaceRoot).loadAsync(agentId);
export const saveAgentAccessPatterns = (
  workspaceRoot: string,
  agentId: string,
  patterns: Parameters<PermFileRegistry['saveAsync']>[1]
) => new PermFileRegistry(workspaceRoot).saveAsync(agentId, patterns);
export const getConfigPath = configurationStorage.getConfigPath.bind(configurationStorage);
export const loadTeamConfig = configurationStorage.loadTeamConfigAsync.bind(configurationStorage);
export const saveTeamConfig = configurationStorage.saveTeamConfigAsync.bind(configurationStorage);
export const getUserConfigPath = configurationStorage.getUserConfigPath.bind(configurationStorage);
export const loadUserConfig = configurationStorage.loadUserConfigAsync.bind(configurationStorage);
export const saveUserConfig = configurationStorage.saveUserConfigAsync.bind(configurationStorage);
export const loadEffectiveConfig =
  configurationStorage.loadEffectiveConfigAsync.bind(configurationStorage);
export const getEnvPath = environmentStorage.getEnvPath.bind(environmentStorage);
export const loadEnvFile = environmentStorage.loadEnvFileAsync.bind(environmentStorage);
export const saveEnvFile = environmentStorage.saveEnvFileAsync.bind(environmentStorage);
export const parseMarkdownSections =
  markdownSectionService.parseMarkdownSections.bind(markdownSectionService);
export const replaceOrAppendMarkdownSection =
  markdownSectionService.replaceOrAppendMarkdownSection.bind(markdownSectionService);
export const buildAgentMarkdown =
  markdownSectionService.buildAgentMarkdown.bind(markdownSectionService);

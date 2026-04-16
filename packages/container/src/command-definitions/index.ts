import type { CliCommandMetadata } from '@ai-team/infrastructure';
import type { CommandDefinitionRegistry, CommandDefinitionSet } from '@ai-team/service';
import { accessCanCommandDefinition } from './access-can.command.js';
import { accessOverlapCommandDefinition } from './access-overlap.command.js';
import { accessWhoCommandDefinition } from './access-who.command.js';
import { avatarCommandDefinition } from './avatar.command.js';
import { chatCommandDefinition } from './chat.command.js';
import { createCommandDefinition } from './create.command.js';
import { dbMigrateCommandDefinition } from './db-migrate.command.js';
import { dbStatusCommandDefinition } from './db-status.command.js';
import { filesAllowCommandDefinition } from './files-allow.command.js';
import { filesDenyCommandDefinition } from './files-deny.command.js';
import { filesPatternsCommandDefinition } from './files-patterns.command.js';
import { filesTreeCommandDefinition } from './files-tree.command.js';
import { fireCommandDefinition } from './fire.command.js';
import { graphCommandDefinition } from './graph.command.js';
import { hhRefreshCommandDefinition } from './hh-refresh.command.js';
import { hireCommandDefinition } from './hire.command.js';
import { orgCommandDefinition } from './org.command.js';
import { patchApplyCommandDefinition } from './patch-apply.command.js';
import { resolveEmployeesCommandDefinition } from './resolve-employees.command.js';
import { searchCommandDefinition } from './search.command.js';
import { skillsAddCommandDefinition } from './skills-add.command.js';
import { skillsListCommandDefinition } from './skills-list.command.js';
import { skillsRemoveCommandDefinition } from './skills-remove.command.js';
import { systemInfoCommandDefinition } from './system-info.command.js';
import { testConnectionCommandDefinition } from './test-connection.command.js';
import { toolsAllowCommandDefinition } from './tools-allow.command.js';
import { toolsDenyCommandDefinition } from './tools-deny.command.js';
import { toolsListCommandDefinition } from './tools-list.command.js';

export const DEFAULT_COMMAND_DEFINITIONS: CommandDefinitionSet = [
  resolveEmployeesCommandDefinition,
  accessWhoCommandDefinition,
  accessCanCommandDefinition,
  accessOverlapCommandDefinition,
  filesTreeCommandDefinition,
  filesAllowCommandDefinition,
  filesDenyCommandDefinition,
  filesPatternsCommandDefinition,
  toolsListCommandDefinition,
  toolsAllowCommandDefinition,
  toolsDenyCommandDefinition,
  skillsListCommandDefinition,
  skillsAddCommandDefinition,
  skillsRemoveCommandDefinition,
  searchCommandDefinition,
  hireCommandDefinition,
  createCommandDefinition,
  chatCommandDefinition,
  graphCommandDefinition,
  orgCommandDefinition,
  fireCommandDefinition,
  avatarCommandDefinition,
  systemInfoCommandDefinition,
  dbStatusCommandDefinition,
  dbMigrateCommandDefinition,
  patchApplyCommandDefinition,
  hhRefreshCommandDefinition,
  testConnectionCommandDefinition,
];

export const CLI_COMMAND_METADATA_BY_KEY = new Map<string, CliCommandMetadata>(
  DEFAULT_COMMAND_DEFINITIONS.flatMap((definition) =>
    definition.cliMetadata ? [[definition.cliMetadata.key, definition.cliMetadata] as const] : []
  )
);

export function registerDefaultCommandDefinitions(registry: CommandDefinitionRegistry): void {
  registry.add(...DEFAULT_COMMAND_DEFINITIONS);
}

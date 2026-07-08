import type { ICommandsService } from '@ai-team/api-contracts';
import type { ChatCommandRegistryEntry } from '@ai-team/api-contracts';
import type { IConfigurationStorage, ISkillManager } from '@ai-team/core';
import { EmitService } from '../orchestrator/services/emit-service.js';
import { IN_CHAT_COMMAND_REGISTRY } from '../command-registry.js';
import {
  buildDynamicSlashCatalog,
  toDynamicChatCommandRegistryEntries,
} from '../orchestrator/dynamic-slash/catalog.js';
import { readDynamicSlashCatalogConfig } from '../orchestrator/dynamic-slash/config.js';

export class CommandsService implements ICommandsService {
  private readonly startupWarnings = new Set<string>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly skillManager: ISkillManager,
    private readonly configurationStorage: IConfigurationStorage
  ) {}

  async list(): Promise<ChatCommandRegistryEntry[]> {
    const webChatCommandRegistry = IN_CHAT_COMMAND_REGISTRY;
    const reservedKeys = new Set<string>();
    for (const command of webChatCommandRegistry) {
      reservedKeys.add(command.key.toLowerCase());
      for (const alias of command.aliases ?? []) {
        reservedKeys.add(alias.toLowerCase());
      }
    }

    const dynamic = await buildDynamicSlashCatalog({
      workspaceRoot: this.workspaceRoot,
      skillManager: this.skillManager,
      reservedKeys,
      dynamicSlashCatalog: readDynamicSlashCatalogConfig({
        dynamicSlashCatalog:
          this.configurationStorage.get('dynamicSlashCatalog') ?? undefined,
      }),
      emitService: EmitService.forConsole(),
    });

    for (const warning of dynamic.warnings) {
      if (this.startupWarnings.has(warning)) continue;
      this.startupWarnings.add(warning);
      console.warn(warning);
    }

    return [...webChatCommandRegistry, ...toDynamicChatCommandRegistryEntries(dynamic.entries)];
  }
}

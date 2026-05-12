import type { ICommandsService } from '@ai-team/api-contracts';
import type { ChatCommandRegistryEntry } from '@ai-team/api-contracts';
import type { IConfigurationStorage, ISkillManager } from '@ai-team/core';
import { buildChatCommandRegistry } from '../commands/chat/chat-commands.command.js';
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
    private readonly configurationStorage: Pick<IConfigurationStorage, 'loadEffectiveConfigAsync'>
  ) {}

  async list(): Promise<ChatCommandRegistryEntry[]> {
    const webChatCommandRegistry = buildChatCommandRegistry({ includeCliChat: false });
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
      dynamicSlashCatalog: readDynamicSlashCatalogConfig(
        await this.configurationStorage.loadEffectiveConfigAsync(this.workspaceRoot)
      ),
    });

    for (const warning of dynamic.warnings) {
      if (this.startupWarnings.has(warning)) continue;
      this.startupWarnings.add(warning);
      console.warn(warning);
    }

    return [...webChatCommandRegistry, ...toDynamicChatCommandRegistryEntries(dynamic.entries)];
  }
}

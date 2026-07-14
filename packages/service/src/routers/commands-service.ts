import type { ICommandsService } from '@ai-team/api-contracts';
import type { ChatCommandRegistryEntry } from '@ai-team/api-contracts';
import type { IConfigurationStorage, ISkillManager } from '@ai-team/core';
import { EmitService } from '../interaction/emit-service.js';
import { IN_CHAT_COMMAND_REGISTRY } from '../commands/chat/chat-command-registry.js';
import {
  DynamicSlashCatalogService,
  DynamicSlashCommandFactory,
} from '../command-dispatcher/dynamic-slash/catalog.js';
import { DynamicSlashCatalogConfigReader } from '../command-dispatcher/dynamic-slash/config.js';

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

    const dynamic = await new DynamicSlashCatalogService({
      workspaceRoot: this.workspaceRoot,
      skillManager: this.skillManager,
      reservedKeys,
      dynamicSlashCatalog: new DynamicSlashCatalogConfigReader().read({
        dynamicSlashCatalog: this.configurationStorage.get('dynamicSlashCatalog') ?? undefined,
      }),
    }).buildAsync();

    for (const warning of dynamic.warnings) {
      if (this.startupWarnings.has(warning)) continue;
      this.startupWarnings.add(warning);
      console.warn(warning);
    }

    const commandFactory = new DynamicSlashCommandFactory(EmitService.noop());
    return [
      ...webChatCommandRegistry,
      ...commandFactory.toChatCommandRegistryEntries(dynamic.entries),
    ];
  }
}

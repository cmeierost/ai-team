import type { ChatCommandRegistryEntry, ICommandsService } from '@ai-team/api-contracts';
import type {
  IConfigurationStorage,
  ICommandDispatcher,
  IEmitService,
  ISkillManager,
  ISessionManager,
  IToolManager,
} from '@ai-team/core';
import {
  DynamicSlashCatalogService,
  DynamicSlashCommandFactory,
} from '../command-dispatcher/dynamic-slash/catalog.js';
import { DynamicSlashCatalogConfigReader } from '../command-dispatcher/dynamic-slash/config.js';
import { formatSlashInvocation } from '../command-dispatcher/slash-invocation.js';
import { GROUP_REGISTRY } from '../commands/groups.js';

export class CommandsService implements ICommandsService {
  private readonly startupWarnings = new Set<string>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly commandDispatcher: Pick<ICommandDispatcher, 'getCommands'>,
    private readonly skillManager: ISkillManager,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly emitService: IEmitService,
    private readonly sessionManager: Pick<
      ISessionManager,
      'addSessionSkill' | 'setSessionSkillPaused'
    >,
    private readonly toolManager: Pick<IToolManager, 'execute'>
  ) {}

  async list(): Promise<ChatCommandRegistryEntry[]> {
    const registeredChatCommands = this.commandDispatcher.getCommands({ chat: true });
    const webChatCommandRegistry = registeredChatCommands.map((command) => ({
      ...command,
      usage: formatSlashInvocation(command),
    })) as ChatCommandRegistryEntry[];
    const reservedKeys = new Set<string>(Object.keys(GROUP_REGISTRY).map((key) => key.toLowerCase()));
    for (const command of registeredChatCommands) {
      reservedKeys.add(command.key.toLowerCase());
      if (command.group) reservedKeys.add(`${command.group}-${command.key}`.toLowerCase());
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

    const commandFactory = new DynamicSlashCommandFactory(
      this.workspaceRoot,
      this.emitService,
      this.sessionManager,
      this.toolManager
    );
    return [
      ...webChatCommandRegistry,
      ...commandFactory.toChatCommandRegistryEntries(dynamic.entries),
    ];
  }
}

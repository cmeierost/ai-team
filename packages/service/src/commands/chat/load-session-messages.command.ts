import type { ChatMessage } from '@ai-team/core';
import type { IConfigurationStorage } from '@ai-team/core';
import type { IEmitService } from '@ai-team/core';
import type { IBackendLogService } from '@ai-team/core';
import type { LogDestinationLevel } from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';

type CommandLogLevel = 'error' | 'warning' | 'info' | 'debug';

const COMMAND_LOG_LEVEL_ORDER: Record<CommandLogLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

export interface LoadSessionMessagesParams {
  sessionId: string;
  reason: 'startup' | 'back-nav';
}

export class LoadSessionMessagesCommand {
  constructor(
    private readonly sessionManager: Pick<SessionManager, 'getSessionMessages'>,
    private readonly emitService: IEmitService,
    private readonly configurationStorage?: Pick<IConfigurationStorage, 'get'>,
    private readonly backendLogService?: IBackendLogService
  ) {}

  private normalizeOutputLevel(value: unknown): LogDestinationLevel {
    if (typeof value === 'boolean') {
      return value ? 'info' : 'off';
    }
    if (typeof value !== 'string') {
      return 'off';
    }

    const normalized = value.trim().toLowerCase();
    if (
      normalized === 'off' ||
      normalized === 'none' ||
      normalized === 'false' ||
      normalized === '0'
    ) {
      return 'off';
    }
    if (normalized === 'true' || normalized === '1' || normalized === 'on') {
      return 'info';
    }

    if (
      normalized === 'error' ||
      normalized === 'warning' ||
      normalized === 'info' ||
      normalized === 'debug'
    ) {
      return normalized;
    }

    return 'off';
  }

  private shouldWrite(entryLevel: CommandLogLevel, threshold: LogDestinationLevel): boolean {
    if (threshold === 'off') {
      return false;
    }
    return COMMAND_LOG_LEVEL_ORDER[entryLevel] <= COMMAND_LOG_LEVEL_ORDER[threshold];
  }

  async execute(params: LoadSessionMessagesParams): Promise<ChatMessage[]> {
    const { sessionId, reason } = params;
    const startedAt = Date.now();
    const messages = await this.sessionManager.getSessionMessages(sessionId);
    const elapsedMs = Date.now() - startedAt;
    const logConfig = this.configurationStorage?.get('log.chat.sessionStartupLoad');
    const logEnabled = logConfig?.enabled === true;
    if (logEnabled) {
      const message = `[perf] loaded ${messages.length} message(s) for session ${sessionId} in ${elapsedMs}ms (${reason})`;
      const entryLevel: CommandLogLevel = 'info';
      const consoleLevel = this.normalizeOutputLevel(logConfig?.console);
      if (this.shouldWrite(entryLevel, consoleLevel)) {
        this.emitService.log('info', message);
      }
      const fileLevel = this.normalizeOutputLevel(logConfig?.file);
      if (this.backendLogService && this.shouldWrite(entryLevel, fileLevel)) {
        this.backendLogService.write({
          source: 'chat-session-startup',
          phase: 'session-history-load',
          level: entryLevel,
          sessionId,
          reason,
          elapsedMs,
          messageCount: messages.length,
          message,
        });
      }
    }
    return messages;
  }
}

import type { ChatOptions } from '@ai-team/api-contracts';
import type { IDeveloperIdentityService } from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';

export interface ResolveChatSessionParams {
  currentAgentId: string;
  options: Pick<ChatOptions, 'sessionId' | 'createNewSession'>;
  developerName?: string;
}

export interface ResolveChatSessionResult {
  sessionId: string;
  shouldLoadHistory: boolean;
  reason: 'startup' | 'back-nav';
}

export class ResolveChatSessionCommand {
  constructor(
    private readonly sessionManager: Pick<SessionManager, 'createSession' | 'getLatestSession'>,
    private readonly developerIdentityService: Pick<IDeveloperIdentityService, 'toDeveloperId'>
  ) {}

  async execute(params: ResolveChatSessionParams): Promise<ResolveChatSessionResult> {
    const { currentAgentId, options, developerName } = params;

    if (options.sessionId) {
      return {
        sessionId: options.sessionId,
        shouldLoadHistory: true,
        reason: 'startup',
      };
    }

    if (options.createNewSession) {
      const developerId = this.developerIdentityService.toDeveloperId(developerName || 'developer');
      const newSession = await this.sessionManager.createSession(currentAgentId, developerId);
      return {
        sessionId: newSession.id,
        shouldLoadHistory: false,
        reason: 'startup',
      };
    }

    const latestSession = await this.sessionManager.getLatestSession(currentAgentId);
    if (latestSession) {
      return {
        sessionId: latestSession.id,
        shouldLoadHistory: true,
        reason: 'startup',
      };
    }

    const developerId = this.developerIdentityService.toDeveloperId(developerName || 'developer');
    const newSession = await this.sessionManager.createSession(currentAgentId, developerId);
    return {
      sessionId: newSession.id,
      shouldLoadHistory: false,
      reason: 'startup',
    };
  }
}

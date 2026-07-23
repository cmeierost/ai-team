import { describe, expect, it, vi } from 'vitest';
import { ChatInfoService } from './chat-info-service.js';

describe('ChatInfoService', () => {
  it('emits the configured agent avatar color with its display identity', () => {
    const emitService = {
      emit: vi.fn(),
      log: vi.fn(),
    };
    const service = new ChatInfoService(emitService as any);

    service.showSessionIntro({
      agent: {
        id: 'michael-brown',
        name: 'Michael Brown',
        role: 'ceo',
        avatar: { type: 'url', color: 'hsl(205, 70%, 60%)' },
      } as any,
      developerName: 'Clemens Meier',
    });

    expect(emitService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent_info',
        agentId: 'michael-brown',
        avatarColor: 'hsl(205, 70%, 60%)',
      })
    );
  });

  it('emits resumed conversation entries as structured history messages', () => {
    const emitService = {
      emit: vi.fn(),
      log: vi.fn(),
    };
    const service = new ChatInfoService(emitService as any);

    service.showSessionResume(
      [
        { content: 'What should we do?', isHuman: true },
        { content: 'We should align the strategy.', isHuman: false },
      ] as any,
      {
        id: 'michael-brown',
        name: 'Michael Brown',
        role: 'ceo',
        avatar: { type: 'url', color: 'hsl(205, 70%, 60%)' },
        resolvedLlm: { model: 'gpt-5.2' },
      } as any,
      'Clemens Meier'
    );

    expect(emitService.emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'history_message',
        isHuman: true,
        content: 'What should we do?',
        developerName: 'Clemens Meier',
      })
    );
    expect(emitService.emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'history_message',
        isHuman: false,
        content: 'We should align the strategy.',
        agentName: 'Michael Brown',
      })
    );
    expect(emitService.log).not.toHaveBeenCalled();
  });

  it('emits the whole resumed thread with historical handoff transitions', () => {
    const emitService = {
      emit: vi.fn(),
      log: vi.fn(),
    };
    const service = new ChatInfoService(emitService as any);
    const michael = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'CEO',
      avatar: { color: 'hsl(205, 70%, 60%)' },
      resolvedLlm: { model: 'gpt-5.2' },
    };
    const emily = {
      id: 'emily-davis',
      name: 'Emily Davis',
      role: 'Engineer',
      avatar: { color: 'hsl(210, 70%, 60%)' },
      resolvedLlm: { model: 'claude-sonnet' },
    };

    service.showThreadResume(
      [
        {
          kind: 'message',
          message: { content: 'Earlier answer', isHuman: false },
          agent: michael,
        },
        {
          kind: 'handoff',
          message: {
            content: 'Emily has the implementation context.',
            from: michael.id,
            to: emily.id,
            handoffFromSessionId: 'session-michael',
            handoffToSessionId: 'session-emily',
          },
          fromAgent: michael,
          toAgent: emily,
        },
      ] as any,
      'Clemens Meier'
    );

    expect(emitService.emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'history_message',
        agentName: 'Michael Brown',
        content: 'Earlier answer',
      })
    );
    expect(emitService.emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'handoff',
        historical: true,
        fromAgentName: 'Michael Brown',
        toAgentName: 'Emily Davis',
        briefingContent: 'Emily has the implementation context.',
      })
    );
  });
});

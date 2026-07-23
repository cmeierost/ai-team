import { describe, expect, it, vi } from 'vitest';
import { ChatInfoService } from './chat-info-service.js';
import { HANDOFF_AUTO_REACT_MESSAGE } from '../../workflow/chat/handoff-auto-react.js';

describe('ChatInfoService', () => {
  it('emits workspace and Git branch metadata for runtime clients', () => {
    const emitService = {
      emit: vi.fn(),
      log: vi.fn(),
    };
    const service = new ChatInfoService(emitService as any);

    service.showWorkspaceInfo({
      workspace: 'C:\\Projects\\ai-team',
      gitBranch: 'feature/tui',
    });

    expect(emitService.emit).toHaveBeenCalledWith({
      kind: 'workspace_info',
      workspace: 'C:\\Projects\\ai-team',
      gitBranch: 'feature/tui',
    });
  });

  it('emits the active session identity after startup resolves it', () => {
    const emitService = {
      emit: vi.fn(),
      log: vi.fn(),
    };
    const service = new ChatInfoService(emitService as any);

    service.showActiveSession({
      sessionId: 'session-2026-07-23-abc123',
      agentId: 'sarah-lee',
    });

    expect(emitService.emit).toHaveBeenCalledWith({
      kind: 'session_switched',
      sessionId: 'session-2026-07-23-abc123',
      agentId: 'sarah-lee',
      source: 'startup',
    });
  });

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

  it('guides people to the normal handoff command', () => {
    const emitService = { emit: vi.fn(), log: vi.fn() };
    const service = new ChatInfoService(emitService as any);

    service.showSessionIntro({
      agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' } as any,
      developerName: 'Clemens Meier',
    });

    expect(emitService.log).toHaveBeenCalledWith(
      'info',
      'Ask to be forwarded or type "/handoff <name>" to switch agents'
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

  it('emits persisted tool results in their resumed transcript position', () => {
    const emitService = {
      emit: vi.fn(),
      log: vi.fn(),
    };
    const service = new ChatInfoService(emitService as any);
    const michael = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'CEO',
    };

    service.showThreadResume(
      [
        {
          kind: 'message',
          message: {
            content: '',
            from: michael.id,
            isHuman: false,
            tool_calls: [
              {
                id: 42,
                tool: 'fs_read',
                params: { path: 'README.md' },
                result: 'Project documentation',
                resultLlm: 'README contents',
              },
            ],
          },
          agent: michael,
        },
      ] as any,
      'Clemens Meier'
    );

    expect(emitService.emit).toHaveBeenCalledOnce();
    expect(emitService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool',
        historical: true,
        toolCallId: '42',
        toolName: 'fs_read',
        toolPhase: 'result',
        input: { path: 'README.md' },
        output: 'Project documentation',
      })
    );
  });

  it('does not replay legacy internal handoff continuations as developer messages', () => {
    const emitService = { emit: vi.fn(), log: vi.fn() };
    const service = new ChatInfoService(emitService as any);

    service.showThreadResume(
      [
        {
          kind: 'message',
          message: {
            content: HANDOFF_AUTO_REACT_MESSAGE,
            from: 'human',
            isHuman: true,
          },
        },
      ] as any,
      'Clemens Meier'
    );

    expect(emitService.emit).not.toHaveBeenCalled();
  });
});

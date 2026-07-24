import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@ai-team/api-contracts';
import { ExtensionRegistry } from '../extensions/index.js';
import {
  WorkflowEventRegistry,
  type EventProjection,
  type WorkflowEventState,
} from './workflow-event-registry.js';
import { UserMessage } from '../tui/user-message.js';
import { visibleWidth } from '@ai-team/tui';

const timestamp = '2026-07-23T10:00:00.000Z';
const stripAnsi = (value: string) => value.replaceAll(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

function createHarness() {
  return {
    registry: new WorkflowEventRegistry(),
    extensions: new ExtensionRegistry(),
    state: {
      currentAgent: null,
      currentResponse: null,
    } satisfies WorkflowEventState,
  };
}

function renderedProjection(projection: EventProjection | null, width = 80): string {
  if (!projection) return '';
  if ('placements' in projection) {
    return projection.placements
      .map((placement) => placement.component.render(width).join('\n'))
      .join('\n');
  }
  return projection.render(width).join('\n');
}

function transcriptComponent(projection: EventProjection | null) {
  if (!projection || !('placements' in projection)) return projection;
  return projection.placements.find((placement) => placement.target === 'transcript')?.component;
}

describe('WorkflowEventRegistry', () => {
  it('renders startup command guidance as a quiet chat hint', () => {
    const harness = createHarness();

    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentName: 'Michael Brown',
        message: 'exit · /help · /handoff <name>',
      },
      harness.state,
      harness.extensions
    );

    const rendered = component?.render(80).join('\n') ?? '';
    expect(rendered).toContain('exit · /help · /handoff <name>');
    expect(rendered).not.toContain('[INFO');
  });

  it('does not render the same live error twice in one turn', () => {
    const harness = createHarness();
    const error = {
      command: 'chat',
      kind: 'error',
      timestamp,
      message: 'Target agent LLM request timed out.',
    } as any;

    expect(harness.registry.handle(error, harness.state, harness.extensions)).not.toBeNull();
    expect(harness.registry.handle(error, harness.state, harness.extensions)).toBeNull();
  });

  it('does not duplicate an error emitted as both a log and a stream error', () => {
    const harness = createHarness();
    const log = {
      command: 'chat',
      kind: 'log',
      timestamp,
      level: 'error',
      message: 'Workflow aborted: request signal was already aborted.',
    } as any;
    const error = {
      command: 'chat',
      kind: 'error',
      timestamp,
      message: log.message,
    } as any;

    const first = harness.registry.handle(log, harness.state, harness.extensions);
    const duplicate = harness.registry.handle(error, harness.state, harness.extensions);

    expect(renderedProjection(first)).toContain(log.message);
    expect(duplicate).toBeNull();
  });

  it('renders streamed token chunks as one agent response', () => {
    const harness = createHarness();
    harness.registry.handle(
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
        developerName: 'Clemens Meier',
        llmModel: 'gpt-5.2',
      },
      harness.state,
      harness.extensions
    );

    const response = harness.registry.handle(
      { command: 'chat', kind: 'token', timestamp, text: 'Hel' },
      harness.state,
      harness.extensions
    );
    const continuation = harness.registry.handle(
      { command: 'chat', kind: 'token', timestamp, text: 'lo' },
      harness.state,
      harness.extensions
    );

    expect(continuation).toBeNull();
    const rendered = response?.render(80).join('\n') ?? '';
    expect(rendered).toContain('Michael Brown');
    expect(rendered).toContain('(gpt-5.2)');
    expect(rendered).toContain('→ Clemens Meier');
    expect(rendered).toContain('Hello');
    expect(rendered).toContain('\x1b[38;2;');
    expect(rendered).toContain('\x1b[48;2;');
    expect(response?.render(80).every((line) => visibleWidth(line) === 80)).toBe(true);
  });

  it('renders resumed agent history through the live agent message component', () => {
    const harness = createHarness();
    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'history_message',
        timestamp,
        isHuman: false,
        content: 'Previously discussed **strategy**.',
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
        developerName: 'Clemens Meier',
        avatarColor: 'hsl(205, 70%, 60%)',
        llmModel: 'gpt-5.2',
      } as any,
      harness.state,
      harness.extensions
    );

    const rendered = renderedProjection(component);
    expect(rendered).toContain('Michael Brown');
    expect(rendered).toContain('→ Clemens Meier');
    expect(rendered).toContain('Previously discussed');
    expect(rendered).toContain('\x1b[48;2;');
    expect(rendered).not.toContain('[INFO');
  });

  it('renders a nested tool result without duplicating its separately logged request', () => {
    const harness = createHarness();
    const event: StreamEvent<'chat'> = {
      command: 'chat',
      kind: 'tool',
      timestamp,
      toolName: 'fs_read',
      toolCallId: 'call-1',
      toolPhase: 'result',
      toolResult: {
        toolName: 'fs_read',
        outcome: 'result',
        request: { path: 'README.md' },
        commandResponse: {
          status: 'ok',
          message: 'file contents',
        },
      },
    };

    const component = harness.registry.handle(event, harness.state, harness.extensions);
    const rendered = stripAnsi(renderedProjection(component));

    expect(rendered).not.toContain('README.md');
    expect(rendered).toContain('file contents');
  });

  it('keeps tool request and result as separate immutable transcript entries', () => {
    const harness = createHarness();
    const requested = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'fs_read',
        toolCallId: 'call-1',
        toolPhase: 'request',
        toolResult: {
          toolName: 'fs_read',
          outcome: 'request',
          request: { path: 'README.md' },
        },
      },
      harness.state,
      harness.extensions
    );
    const completed = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'fs_read',
        toolCallId: 'call-1',
        toolPhase: 'result',
        toolResult: {
          toolName: 'fs_read',
          outcome: 'result',
          request: { path: 'README.md' },
          commandResponse: { status: 'ok', message: 'done' },
        },
      },
      harness.state,
      harness.extensions
    );

    const requestText = transcriptComponent(requested)?.render(80).join('\n') ?? '';
    const resultText = transcriptComponent(completed)?.render(80).join('\n') ?? '';
    expect(requestText).toContain('[request]');
    expect(requestText).toContain('README.md');
    expect(requestText).not.toContain('done');
    expect(resultText).toContain('[result]');
    expect(resultText).toContain('done');
    expect(resultText).not.toContain('README.md');
  });

  it('renders each historical tool result without merging replayed calls', () => {
    const harness = createHarness();
    const first = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        historical: true,
        toolName: 'fs_read',
        toolPhase: 'result',
        input: { path: 'one.md' },
        output: 'first result',
      } as any,
      harness.state,
      harness.extensions
    );
    const second = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        historical: true,
        toolName: 'fs_read',
        toolPhase: 'result',
        input: { path: 'two.md' },
        output: 'second result',
      } as any,
      harness.state,
      harness.extensions
    );

    expect(renderedProjection(first)).toContain('first result');
    expect(renderedProjection(second)).toContain('second result');
  });

  it('uses a bounded preview for a large historical tool result', () => {
    const harness = createHarness();
    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        historical: true,
        toolName: 'search_grep',
        toolPhase: 'result',
        input: { pattern: 'TODO' },
        output: Array.from(
          { length: 30 },
          (_, index) => `result ${index + 1}`
        ).join('\n'),
      } as any,
      harness.state,
      harness.extensions
    );

    const rendered = renderedProjection(component);
    expect(rendered).toContain('result 1');
    expect(rendered).not.toContain('result 30');
    expect(rendered).toContain('more lines');
  });

  it('keeps handoff briefing content visible in the transcript', () => {
    const harness = createHarness();
    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        fromAgentId: 'michael-brown',
        fromAgentName: 'Michael Brown',
        toAgentId: 'sarah-lee',
        toAgentName: 'Sarah Lee',
        toAvatarColor: 'hsl(120, 60%, 50%)',
        toLlmModel: 'best-chat',
        briefingContent: 'Preserve the event-driven service boundary.',
      },
      harness.state,
      harness.extensions
    );

    const renderedLines = component?.render(80) ?? [];
    const rendered = renderedLines.join('\n');
    expect(rendered).toContain(
      'Preserve the event-driven service boundary.'
    );
    expect(rendered).toContain('Michael Brown');
    expect(rendered).toContain('→ Sarah Lee \x1b[2m(best-chat)');
    expect(rendered).toContain('\x1b[48;2;');
    expect(renderedLines.every((line) => visibleWidth(line) === 80)).toBe(true);
    expect(harness.state.currentAgent?.name).toBe('Sarah Lee');
  });

  it('does not render identical handoff reason and briefing content twice', () => {
    const harness = createHarness();
    const repeated = 'User explicitly requested to switch to michael.';
    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        fromAgentId: 'emily-davis',
        fromAgentName: 'Emily Davis',
        toAgentId: 'michael-brown',
        toAgentName: 'Michael Brown',
        handoffNote: repeated,
        briefingContent: repeated,
      },
      harness.state,
      harness.extensions
    );

    const rendered = component?.render(100).join('\n') ?? '';
    expect(rendered.match(/User explicitly requested to switch to michael\./g)).toHaveLength(1);
  });

  it('streams a tool-owned handoff briefing into one source-to-target message', () => {
    const harness = createHarness();
    const start = harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-1',
        handoffPhase: 'start',
        fromAgentId: 'emily-davis',
        fromAgentName: 'Emily Davis',
        toAgentId: 'michael-brown',
        toAgentName: 'Michael Brown',
      },
      harness.state,
      harness.extensions
    );

    harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-1',
        handoffPhase: 'delta',
        fromAgentId: 'emily-davis',
        toAgentId: 'michael-brown',
        delta: 'Clemens wants to ',
      },
      harness.state,
      harness.extensions
    );
    harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-1',
        handoffPhase: 'delta',
        fromAgentId: 'emily-davis',
        toAgentId: 'michael-brown',
        delta: 'continue with Michael.',
      },
      harness.state,
      harness.extensions
    );

    expect(start?.render(100).join('\n')).toContain(
      'Clemens wants to continue with Michael.'
    );
    expect(harness.state.currentAgent?.name).not.toBe('Michael Brown');

    const complete = harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-1',
        handoffPhase: 'complete',
        fromAgentId: 'emily-davis',
        fromAgentName: 'Emily Davis',
        toAgentId: 'michael-brown',
        toAgentName: 'Michael Brown',
        toLlmModel: 'gpt-5.2',
        briefingContent: 'Clemens wants to continue with Michael.',
      },
      harness.state,
      harness.extensions
    );

    expect(complete).toBeNull();
    expect(harness.state.currentAgent?.name).toBe('Michael Brown');
    expect(harness.state.currentAgent?.model).toBe('gpt-5.2');
    expect(start?.render(100).join('\n')).toContain(
      'Clemens wants to continue with Michael.'
    );

    harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-back-1',
        handoffPhase: 'start',
        fromAgentId: 'michael-brown',
        fromAgentName: 'Michael Brown',
        fromLlmModel: 'gpt-5.2',
        toAgentId: 'emily-davis',
        toAgentName: 'Emily Davis',
        toLlmModel: 'best-chat',
      },
      harness.state,
      harness.extensions
    );
    harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-back-1',
        handoffPhase: 'complete',
        fromAgentId: 'michael-brown',
        fromAgentName: 'Michael Brown',
        fromLlmModel: 'gpt-5.2',
        toAgentId: 'emily-davis',
        toAgentName: 'Emily Davis',
        toLlmModel: 'best-chat',
        briefingContent: 'Returning to Emily.',
      },
      harness.state,
      harness.extensions
    );

    expect(harness.state.currentAgent).toMatchObject({
      name: 'Emily Davis',
      model: 'best-chat',
    });
  });

  it('renders a resumed handoff without changing the active agent', () => {
    const harness = createHarness();
    harness.registry.handle(
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentName: 'Sarah Lee',
      },
      harness.state,
      harness.extensions
    );

    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        historical: true,
        fromAgentId: 'michael-brown',
        fromAgentName: 'Michael Brown',
        fromAvatarColor: 'hsl(205, 70%, 60%)',
        fromLlmModel: 'gpt-5.2',
        toAgentId: 'emily-davis',
        toAgentName: 'Emily Davis',
        briefingContent: 'Emily received the earlier context.',
      },
      harness.state,
      harness.extensions
    );

    const rendered = component?.render(80).join('\n') ?? '';
    expect(rendered).toContain('Michael Brown');
    expect(rendered).toContain('(gpt-5.2)');
    expect(rendered).toContain('→ Emily Davis:');
    expect(harness.state.currentAgent?.name).toBe('Sarah Lee');
  });

  it('renders slash-command results separately after the developer invocation', () => {
    const harness = createHarness();
    const userMessage = new UserMessage('/help', 'Clemens');
    harness.state.currentUserMessage = userMessage;

    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'slash:help',
        toolPhase: 'result',
        toolResult: {
          toolName: 'slash:help',
          outcome: 'result',
          commandResponse: {
            status: 'ok',
            message: 'Available in-chat commands.',
          },
        },
      },
      harness.state,
      harness.extensions
    );

    expect(renderedProjection(component)).toContain('Available in-chat commands.');
    expect(userMessage.render(80).join('\n')).not.toContain('Available in-chat commands.');
  });

  it('renders structured /fs tree results with the fs_tree component', () => {
    const harness = createHarness();
    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'slash:tree',
        toolPhase: 'result',
        toolResult: {
          toolName: 'slash:tree',
          commandGroup: 'fs',
          commandKey: 'tree',
          outcome: 'result',
          resultLlm: '.\n\nsrc/\n  index.ts',
          commandResponse: {
            status: 'ok',
            data: {
              status: 'ok',
              data: {
                path: '.',
                denied: 0,
                tree: {
                  name: '.',
                  isDirectory: true,
                  children: [
                    {
                      name: 'src',
                      isDirectory: true,
                      rights: { l: true, r: true, w: false },
                      children: [{ name: 'index.ts', isDirectory: false }],
                    },
                  ],
                },
              },
            },
          },
        },
      },
      harness.state,
      harness.extensions
    );

    const rendered = renderedProjection(component);
    expect(rendered).toContain('src/');
    expect(rendered).toContain('index.ts');
    expect(rendered).not.toContain('(empty or not accessible)');
  });

  it('renders a persisted /fs read result from its command group and key', () => {
    const harness = createHarness();
    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        historical: true,
        toolName: 'slash:read',
        toolPhase: 'result',
        input: {
          commandKey: 'fs-read',
          commandToken: 'fs read',
          rawInput: '/fs read package.json',
        },
        output: {
          path: 'package.json',
          content: '{ "name": "ai-team" }',
          startLine: 1,
          endLine: 1,
          isFullFile: true,
        },
      } as any,
      harness.state,
      harness.extensions
    );

    const rendered = stripAnsi(renderedProjection(component));
    expect(rendered).toContain('File: package.json');
    expect(rendered).toContain('Scope: full-file lines 1-1');
    expect(rendered).toContain('1 │ { "name": "ai-team" }');
  });

  it('renders live /fs read from structured command data instead of LLM text', () => {
    const harness = createHarness();
    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'slash:read',
        toolPhase: 'result',
        toolResult: {
          toolName: 'slash:read',
          commandGroup: 'fs',
          commandKey: 'read',
          outcome: 'result',
          resultLlm: 'backend text that must not feed the fs_read renderer',
          commandResponse: {
            status: 'ok',
            message: '',
            data: {
              path: 'package.json',
              content: '{ "name": "ai-team" }',
              startLine: 1,
              endLine: 1,
              isFullFile: true,
            },
          },
        },
      } as any,
      harness.state,
      harness.extensions
    );

    const rendered = stripAnsi(renderedProjection(component));
    expect(rendered).toContain('File: package.json');
    expect(rendered).toContain('1 │ { "name": "ai-team" }');
    expect(rendered).not.toContain('backend text');
  });

  it('uses backend LLM text when no exact command renderer exists', () => {
    const harness = createHarness();
    const component = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'slash:status',
        toolPhase: 'result',
        toolResult: {
          toolName: 'slash:status',
          commandGroup: 'system',
          commandKey: 'status',
          outcome: 'result',
          resultLlm: 'Human-readable backend status',
          commandResponse: {
            status: 'ok',
            message: '',
            data: { deeply: { nested: true } },
          },
        },
      } as any,
      harness.state,
      harness.extensions
    );

    const rendered = renderedProjection(component);
    expect(rendered).toContain('Human-readable backend status');
    expect(rendered).not.toContain('"nested"');
  });

  it('keeps repeated slash results distinct and renders live output like history', () => {
    const harness = createHarness();
    const live = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'slash:help',
        toolPhase: 'result',
        toolResult: {
          toolName: 'slash:help',
          outcome: 'result',
          request: { rawInput: '/help' },
          resultLlm: 'Help result',
        },
      },
      harness.state,
      harness.extensions
    );
    const repeated = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'slash:help',
        toolPhase: 'result',
        toolResult: {
          toolName: 'slash:help',
          outcome: 'result',
          request: { rawInput: '/help' },
          resultLlm: 'Help result',
        },
      },
      harness.state,
      harness.extensions
    );
    const historical = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        historical: true,
        toolName: 'slash:help',
        toolPhase: 'result',
        input: { rawInput: '/help' },
        output: 'Help result',
      } as any,
      harness.state,
      harness.extensions
    );

    expect(renderedProjection(live)).toContain('Help result');
    expect(renderedProjection(repeated)).toContain('Help result');
    expect(renderedProjection(historical)).toBe(renderedProjection(live));
  });

  it('updates the current user entry with the authoritative developer name', () => {
    const harness = createHarness();
    const userMessage = new UserMessage('hello');
    harness.state.currentUserMessage = userMessage;

    harness.registry.handle(
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
        developerName: 'Clemens Meier',
      },
      harness.state,
      harness.extensions
    );

    const rendered = userMessage.render(80).join('\n');
    expect(rendered).toContain('Clemens Meier');
    expect(rendered).not.toContain('You');
  });

  it('streams thinking separately and collapses it when visible output begins', () => {
    const harness = createHarness();
    harness.registry.handle(
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentName: 'Michael Brown',
        developerName: 'Clemens Meier',
      },
      harness.state,
      harness.extensions
    );

    const thinking = harness.registry.handle(
      { command: 'chat', kind: 'token', timestamp, text: '💭 Inspecting the request' },
      harness.state,
      harness.extensions
    );
    const continuation = harness.registry.handle(
      { command: 'chat', kind: 'token', timestamp, text: '💭 and choosing an approach.' },
      harness.state,
      harness.extensions
    );

    expect(continuation).toBeNull();
    expect(thinking?.render(80).join('\n')).toContain('\x1b[38;2;');
    expect(thinking?.render(80).join('\n')).toContain('Inspecting the request');
    expect(thinking?.render(80).join('\n')).toContain('choosing an approach');

    const response = harness.registry.handle(
      { command: 'chat', kind: 'token', timestamp, text: 'Here is the answer.' },
      harness.state,
      harness.extensions
    );

    const collapsed = thinking?.render(80).join('\n') ?? '';
    expect(collapsed).toContain('Thought process');
    expect(collapsed).not.toContain('Inspecting the request');
    expect(response?.render(80).join('\n')).toContain('Here is the answer.');
  });
});

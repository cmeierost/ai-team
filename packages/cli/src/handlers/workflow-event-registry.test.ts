import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@ai-team/api-contracts';
import { ExtensionRegistry } from '../extensions/index.js';
import {
  WorkflowEventRegistry,
  type WorkflowEventState,
} from './workflow-event-registry.js';
import { UserMessage } from '../tui/user-message.js';
import { visibleWidth } from '@ai-team/tui';

const timestamp = '2026-07-23T10:00:00.000Z';

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

describe('WorkflowEventRegistry', () => {
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

    const rendered = component?.render(80).join('\n') ?? '';
    expect(rendered).toContain('Michael Brown');
    expect(rendered).toContain('→ Clemens Meier');
    expect(rendered).toContain('Previously discussed');
    expect(rendered).toContain('\x1b[48;2;');
    expect(rendered).not.toContain('[INFO');
  });

  it('renders nested tool request and result payloads from the shared event contract', () => {
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
    const rendered = component?.render(80).join('\n') ?? '';

    expect(rendered).toContain('README.md');
    expect(rendered).toContain('file contents');
  });

  it('updates one tool component across lifecycle phases', () => {
    const harness = createHarness();
    const started = harness.registry.handle(
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'fs_read',
        toolCallId: 'call-1',
        toolPhase: 'start',
        toolResult: {
          toolName: 'fs_read',
          outcome: 'start',
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

    expect(started).not.toBeNull();
    expect(completed).toBeNull();
    expect(started?.render(80).join('\n')).toContain('[result]');
    expect(started?.render(80).join('\n')).toContain('done');
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
    expect(rendered).toContain('→ Sarah Lee:');
    expect(rendered).toContain('\x1b[48;2;');
    expect(renderedLines.every((line) => visibleWidth(line) === 80)).toBe(true);
    expect(harness.state.currentAgent?.name).toBe('Sarah Lee');
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

  it('attaches slash-command results to the current user message', () => {
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

    expect(component).toBeNull();
    expect(userMessage.render(80).join('\n')).toContain('Available in-chat commands.');
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

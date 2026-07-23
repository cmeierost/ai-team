import { describe, expect, it } from 'vitest';
import { Text } from '@ai-team/tui';
import { ExtensionRegistry } from './registry.js';

const baseEvent = {
  phase: 'result' as const,
  historical: false,
  output: 'default',
};

describe('ExtensionRegistry tool renderers', () => {
  it('prefers an exact renderer over the default slash wildcard', () => {
    const registry = new ExtensionRegistry();
    registry.register({
      name: 'custom-help',
      toolRenderers: [{
        toolName: 'slash:help',
        render: () => ({
          handled: true,
          placements: [{ target: 'transcript', component: new Text('custom help') }],
        }),
      }],
    });

    const decision = registry.renderTool({ ...baseEvent, toolName: 'slash:help' });
    expect(decision.placements[0]?.component.render(80)).toEqual(['custom help']);
  });

  it('supports handled-without-output and reports unhandled tools', () => {
    const registry = new ExtensionRegistry();
    registry.register({
      name: 'silent',
      toolRenderers: [{
        toolName: 'quiet',
        render: () => ({ handled: true, placements: [] }),
      }],
    });

    expect(registry.renderTool({ ...baseEvent, toolName: 'quiet' })).toEqual({
      handled: true,
      placements: [],
    });
    expect(registry.renderTool({ ...baseEvent, toolName: 'unknown' })).toEqual({
      handled: false,
      placements: [],
    });
  });

  it('suppresses active com_ask phases and summarizes choices and passwords', () => {
    const registry = new ExtensionRegistry();
    const request = {
      kind: 'select',
      message: 'Choose owner',
      choices: [{ name: 'Sarah Lee', value: 'sarah-lee' }],
    };
    expect(registry.renderTool({
      toolName: 'com_ask',
      phase: 'start',
      callId: 'ask-1',
      request,
      historical: false,
    }).placements).toEqual([]);

    const result = registry.renderTool({
      toolName: 'com_ask',
      phase: 'result',
      callId: 'ask-1',
      request,
      output: { type: 'com_ask_result', kind: 'select', answer: 'sarah-lee' },
      historical: false,
    });
    expect(result.placements[0]?.component.render(80).join('\n')).toContain('Sarah Lee');

    const password = registry.renderTool({
      toolName: 'com_ask',
      phase: 'result',
      callId: 'ask-2',
      request: { kind: 'password', message: 'API key' },
      output: { type: 'com_ask_result', kind: 'password', answer: 'secret' },
      historical: false,
    });
    const rendered = password.placements[0]?.component.render(80).join('\n') ?? '';
    expect(rendered).toContain('••••••••');
    expect(rendered).not.toContain('secret');
  });
});

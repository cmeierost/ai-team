import { describe, expect, it } from 'vitest';
import { Text } from '@ai-team/tui';
import { ExtensionRegistry } from './registry.js';
import { RunCommandResult } from '../tui/tool-results.js';

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

  it('updates one live slash:run result and appends terminal completion', () => {
    const registry = new ExtensionRegistry();
    const started = registry.renderTool({
      toolName: 'slash:run',
      phase: 'start',
      callId: 'run-1',
      output: { type: 'command_output_start', text: '$ pnpm build\n\n' },
      historical: false,
    });
    const component = started.placements[0]?.component;
    expect(component).toBeInstanceOf(RunCommandResult);

    const delta = registry.renderTool({
      toolName: 'slash:run',
      phase: 'start',
      callId: 'run-1',
      output: { type: 'command_output_delta', stream: 'stdout', text: 'building...\n' },
      historical: false,
    });
    const completed = registry.renderTool({
      toolName: 'slash:run',
      phase: 'result',
      callId: 'run-1',
      output: '$ pnpm build\n\nbuilding...\ndone',
      historical: false,
    });

    expect(delta.placements).toEqual([]);
    expect(completed.placements).toEqual([]);
    expect(component?.render(80).join('\n')).toContain('done');
  });

  it('uses the same streaming renderer for agent-invoked cli_run', () => {
    const registry = new ExtensionRegistry();
    const started = registry.renderTool({
      toolName: 'cli_run',
      phase: 'start',
      callId: 'tool-run-1',
      output: { type: 'command_output_delta', stream: 'stdout', text: 'live\n' },
      historical: false,
    });

    expect(started.handled).toBe(true);
    expect(started.placements[0]?.component.render(80).join('\n')).toContain('live');
  });

  it('renders the complete handoff result without the generic preview truncation', () => {
    const registry = new ExtensionRegistry();
    const decision = registry.renderTool({
      toolName: 'com_handoff',
      phase: 'result',
      historical: true,
      output: Array.from({ length: 14 }, (_, index) => `briefing line ${index + 1}`).join('\n'),
    });

    const rendered = decision.placements[0]?.component.render(100).join('\n') ?? '';
    expect(rendered).toContain('briefing line 14');
    expect(rendered).not.toContain('more lines');
  });

  it('does not shrink streamed output when a run command finishes with a shorter error', () => {
    const registry = new ExtensionRegistry();
    const started = registry.renderTool({
      toolName: 'slash:run',
      phase: 'start',
      callId: 'run-help',
      output: {
        type: 'command_output_delta',
        stream: 'stdout',
        text: 'long help output\nsecond line\nthird line',
      },
      historical: false,
    });
    const component = started.placements[0]?.component;

    registry.renderTool({
      toolName: 'slash:run',
      phase: 'error',
      callId: 'run-help',
      error: 'Command exited with code 1.',
      historical: false,
    });

    const rendered = component?.render(80).join('\n');
    expect(rendered).toContain('long help output');
    expect(rendered).toContain('Command exited with code 1.');
  });

  it('sanitizes terminal control sequences in streamed run output', () => {
    const registry = new ExtensionRegistry();
    const started = registry.renderTool({
      toolName: 'slash:run',
      phase: 'start',
      callId: 'run-controls',
      output: {
        type: 'command_output_delta',
        stream: 'stdout',
        text: '\x1b[2Jvisible',
      },
      historical: false,
    });

    expect(started.placements[0]?.component.render(80)).toEqual(['visible']);
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

  it('renders fs_tree as a standalone sorted access-aware tree', () => {
    const registry = new ExtensionRegistry();
    expect(registry.renderTool({
      toolName: 'fs_tree', phase: 'start', historical: false, output: undefined,
    }).placements).toEqual([]);

    const decision = registry.renderTool({
      toolName: 'fs_tree',
      phase: 'result',
      historical: false,
      output: {
        path: '.',
        denied: 2,
        tree: {
          name: '.', isDirectory: true,
          children: [
            { name: 'README.md', isDirectory: false, rights: { r: true } },
            { name: 'src', isDirectory: true, rights: { r: true, w: true, l: true }, children: [
              { name: 'index.ts', isDirectory: false },
            ] },
          ],
        },
      },
    });
    const rendered = decision.placements[0]?.component.render(80).join('\n') ?? '';
    expect(rendered).toContain('src/');
    expect(rendered.indexOf('src/')).toBeLessThan(rendered.indexOf('README.md'));
    expect(rendered).toContain('[rwl]');
    expect(rendered).toContain('2 items hidden — access restricted');
  });

  it('renders fs_read as a compact file preview with omitted-line count', () => {
    const registry = new ExtensionRegistry();
    const content = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
    const decision = registry.renderTool({
      toolName: 'fs_read',
      phase: 'result',
      historical: false,
      request: { filePath: 'src/index.ts', offset: 1, limit: 2000 },
      output: { path: 'src/index.ts', content, startLine: 1, endLine: 30, isFullFile: true },
    });
    const rendered = decision.placements[0]?.component.render(120).join('\n') ?? '';
    expect(rendered).toContain('File: src/index.ts');
    expect(rendered).toContain('Scope: full-file lines 1-30');
    expect(rendered).toContain('line 1');
    expect(rendered).toContain('more lines');
    expect(rendered).not.toContain('line 30');
  });
});

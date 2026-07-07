import { describe, expect, it } from 'vitest';

import { CLI_COMMAND_REGISTRY, getCliCommandMetadata, getLlmCallableCliCommands } from './registry.js';

describe('command registry metadata', () => {
  it('keeps command keys unique after registry merge', () => {
    const seen = new Set<string>();
    for (const entry of CLI_COMMAND_REGISTRY) {
      expect(seen.has(entry.key)).toBe(false);
      seen.add(entry.key);
    }
  });

  it('stores command help metadata for init in the registry', () => {
    const init = getCliCommandMetadata('init');

    expect(init.description).toContain('Initialize AI Team');
    expect(init.command).toBe('init');
  });

  it('excludes init from LLM-callable command list', () => {
    const llmCommands = getLlmCallableCliCommands();

    expect(llmCommands.find(command => command.key === 'init')).toBeUndefined();
    expect(CLI_COMMAND_REGISTRY.find(command => command.key === 'init')?.llmCallable).toBe(false);
  });

  it('registers tool command metadata from dispatcher command definitions', () => {
    const tools = getCliCommandMetadata('tool');

    expect(tools.command).toBe('tool');
    expect(tools.directCli).toBe(true);
    // Parent command groups are synthetic/direct-cli commands and are not
    // guaranteed to be LLM-callable themselves.
    expect(tools.llmCallable).toBe(false);
  });

  it('marks direct CLI commands explicitly in the shared registry', () => {
    const init = getCliCommandMetadata('init');
    const toolsAllow = getCliCommandMetadata('tool.allow');

    expect(init.directCli).toBe(true);
    expect(toolsAllow.directCli).toBe(true);
    expect(toolsAllow.command).toBe('allow');
  });

});

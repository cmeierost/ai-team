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

  it('registers tools command metadata from dispatcher command definitions', () => {
    const tools = getCliCommandMetadata('tools');

    expect(tools.command).toBe('tools');
    expect(tools.directCli).toBe(true);
    expect(tools.llmCallable).toBe(true);
  });

  it('marks direct CLI commands explicitly in the shared registry', () => {
    const init = getCliCommandMetadata('init');
    const toolsAllow = getCliCommandMetadata('tools.allow');

    expect(init.directCli).toBe(true);
    expect(toolsAllow.directCli).toBe(true);
    expect(toolsAllow.aliases).toContain('add');
  });

});

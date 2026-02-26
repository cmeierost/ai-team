import { describe, expect, it } from 'vitest';

import { CLI_COMMAND_REGISTRY, getCliCommandMetadata, getLlmCallableCliCommands } from './registry.js';

describe('command registry metadata', () => {
  it('stores command help metadata for init in the registry', () => {
    const init = getCliCommandMetadata('init');

    expect(init.description).toContain('Initialize AI Team');
    expect(init.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flags: '-t, --template <type>' }),
        expect.objectContaining({ flags: '-f, --force' }),
      ]),
    );
  });

  it('excludes init from LLM-callable command list', () => {
    const llmCommands = getLlmCallableCliCommands();

    expect(llmCommands.find(command => command.key === 'init')).toBeUndefined();
    expect(CLI_COMMAND_REGISTRY.find(command => command.key === 'init')?.llmCallable).toBe(false);
  });
});

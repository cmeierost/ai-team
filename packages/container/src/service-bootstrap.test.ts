import { describe, expect, it } from 'vitest';
import { createContainerWithBootstrap, TOKENS } from './service-bootstrap.js';

describe('service bootstrap', () => {
  it('registers the fuzzy file search required by fs tools in chat workflows', () => {
    const container = createContainerWithBootstrap(
      { workspaceRoot: process.cwd() },
      () => {}
    );

    const fuzzyFileSearch = container.resolve(TOKENS.FuzzyFileSearch);

    expect(fuzzyFileSearch).toBeDefined();
    expect(typeof fuzzyFileSearch.findSimilarRanked).toBe('function');
  });
});

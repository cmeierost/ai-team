import { describe, expect, it } from 'vitest';
import * as ideInterface from '@ai-team/ide-interface';

describe('@ai-team/ide-interface package exports', () => {
  it('exposes the runtime IDE adapter helpers used by api-server', () => {
    expect(ideInterface.createIdeAdapter).toBeTypeOf('function');
    expect(ideInterface.NoopIdeAdapter).toBeTypeOf('function');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { parsePermFile } from './parser.js';
import { resolveContext } from './resolver.js';
import { ContextRegistry } from './registry.js';
import { ContextRuntime } from './context-runtime.js';
import type { GlobalContext } from './types.js';

function makeGlobal(): GlobalContext {
  return {
    files: new Set([
      'docs/readme.md',
      'docs/guide.md',
      'docs/api.json',
      'src/web/index.ts',
      'src/web/app.tsx',
      'src/web/styles.css',
      'src/app/main.ts',
      'src/app/data.json',
      'package.json',
    ]),
  };
}

describe('ContextRegistry', () => {
  let registry: ContextRegistry;
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registry = new ContextRegistry(makeGlobal(), runtime);
  });

  it('register parses and resolves context', () => {
    const perm = parsePermFile('[read]\nsrc/web/**', '');
    const resolved = registry.register('web', perm);
    expect(resolved.read.has('src/web/index.ts')).toBe(true);
    expect(resolved.read.has('docs/readme.md')).toBe(false);
  });

  it('resolve returns registered context', () => {
    const perm = parsePermFile('[read]\ndocs/**', '');
    registry.register('docs', perm);
    const resolved = registry.resolve('docs');
    expect(resolved).toBeDefined();
    expect(resolved!.read.has('docs/readme.md')).toBe(true);
  });

  it('resolve returns undefined for unregistered id', () => {
    expect(registry.resolve('nonexistent')).toBeUndefined();
  });

  it('unregister removes the context', () => {
    const perm = parsePermFile('[read]\ndocs/**', '');
    registry.register('docs', perm);
    registry.unregister('docs');
    expect(registry.resolve('docs')).toBeUndefined();
  });

  it('reregister refreshes against current global', () => {
    const perm = parsePermFile('[read]\nsrc/web/**', '');
    registry.register('web', perm);
    expect(registry.resolve('web')!.read.has('src/web/index.ts')).toBe(true);

    // Update global to a reduced set
    const smallGlobal: GlobalContext = { files: new Set(['src/web/index.ts']) };
    registry.updateGlobal(smallGlobal);

    // After updateGlobal, all contexts are re-resolved
    const resolved = registry.resolve('web');
    expect(resolved).toBeDefined();
    // Only src/web/index.ts remains in global, so read shrinks
    expect(resolved!.read).toEqual(new Set(['src/web/index.ts']));
  });

  it('reregister returns undefined for unregistered id', () => {
    expect(registry.reregister('nonexistent')).toBeUndefined();
  });

  it('all returns all contexts', () => {
    const webPerm = parsePermFile('[read]\nsrc/web/**', '');
    const docsPerm = parsePermFile('[read]\ndocs/**', '');
    registry.register('web', webPerm);
    registry.register('docs', docsPerm);

    const all = registry.all();
    expect(all.size).toBe(2);
    expect(all.has('web')).toBe(true);
    expect(all.has('docs')).toBe(true);
  });

  it('runtime reflects registry changes', () => {
    const perm = parsePermFile('[read]\nsrc/web/**\n\n[write]\nsrc/web/index.ts', '');
    registry.register('web', perm);

    // Runtime should have the context
    expect(runtime.canRead('web', 'src/web/index.ts')).toBe(true);
    expect(runtime.canWrite('web', 'src/web/index.ts')).toBe(true);
    expect(runtime.canWrite('web', 'src/web/app.tsx')).toBe(false);

    // Unregister should clean up runtime too
    registry.unregister('web');
    expect(runtime.canRead('web', 'src/web/index.ts')).toBe(false);
  });
});

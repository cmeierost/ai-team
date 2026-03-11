import { describe, it, expect } from 'vitest';
import { CompiledRuleSet, matchesIgnorePatterns } from '../policy.js';
import type { AccessRule } from '../rights.js';

describe('CompiledRuleSet', () => {
  it('allows when an allow rule matches', () => {
    const rules: AccessRule[] = [
      { right: 'read', effect: 'allow', pathPattern: 'src/**' },
    ];
    const rs = new CompiledRuleSet(rules);
    expect(rs.evaluate('src/foo.ts', 'read')).toEqual({ allowed: true, rule: rules[0] });
  });

  it('implicitly denies when no rule matches', () => {
    const rules: AccessRule[] = [
      { right: 'read', effect: 'allow', pathPattern: 'src/**' },
    ];
    const rs = new CompiledRuleSet(rules);
    expect(rs.evaluate('docs/readme.md', 'read')).toEqual({ allowed: false });
  });

  it('deny takes precedence over allow', () => {
    const rules: AccessRule[] = [
      { right: 'write', effect: 'allow', pathPattern: 'src/**' },
      { right: 'write', effect: 'deny', pathPattern: 'src/secret/**' },
    ];
    const rs = new CompiledRuleSet(rules);
    expect(rs.evaluate('src/secret/key.ts', 'write').allowed).toBe(false);
    expect(rs.evaluate('src/public/app.ts', 'write').allowed).toBe(true);
  });

  it('respects file-name pattern', () => {
    const rules: AccessRule[] = [
      { right: 'create', effect: 'allow', pathPattern: 'docs/**', filePattern: '*.md' },
    ];
    const rs = new CompiledRuleSet(rules);
    expect(rs.evaluate('docs/guide.md', 'create').allowed).toBe(true);
    expect(rs.evaluate('docs/guide.ts', 'create').allowed).toBe(false);
  });

  it('matches specific right only', () => {
    const rules: AccessRule[] = [
      { right: 'read', effect: 'allow', pathPattern: '**' },
    ];
    const rs = new CompiledRuleSet(rules);
    expect(rs.evaluate('any/file.ts', 'read').allowed).toBe(true);
    expect(rs.evaluate('any/file.ts', 'write').allowed).toBe(false);
  });
});

describe('matchesIgnorePatterns', () => {
  it('matches a basic glob', () => {
    expect(matchesIgnorePatterns('node_modules/foo/bar.js', ['node_modules/**'])).toBe(true);
  });

  it('does not match non-matching path', () => {
    expect(matchesIgnorePatterns('src/index.ts', ['node_modules/**'])).toBe(false);
  });

  it('matches dotfiles', () => {
    expect(matchesIgnorePatterns('.env', ['.*'])).toBe(true);
  });

  it('supports negation patterns to unignore specific files', () => {
    expect(matchesIgnorePatterns('.vscode/settings.json', ['.vscode/**', '!.vscode/settings.json'])).toBe(false);
  });

  it('applies last matching pattern wins semantics', () => {
    expect(matchesIgnorePatterns('build/keep.txt', ['build/**', '!build/keep.txt', 'build/keep.txt'])).toBe(true);
  });

  it('treats trailing slash as directory ignore', () => {
    expect(matchesIgnorePatterns('coverage/index.html', ['coverage/'])).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { parsePackageJson, parseTsConfig, parseGenericConfig } from './config-parser.js';

// ── package.json ────────────────────────────────────────────────────────────

describe('parsePackageJson', () => {
  const BASIC_PKG = JSON.stringify({
    name: '@my/app',
    version: '1.0.0',
    scripts: { build: 'tsc', test: 'vitest run' },
    dependencies: { react: '^18.0.0', lodash: '^4.17.0' },
    devDependencies: { typescript: '^5.0.0', '@my/shared': 'workspace:*' },
  }, null, 2);

  it('extracts file entity', () => {
    const { entities } = parsePackageJson(BASIC_PKG, 'package.json');
    const file = entities.find(e => e.kind === 'file');
    expect(file).toBeDefined();
    expect(file!.id).toBe('file:package.json');
    expect(file!.role).toBe('infrastructure');
  });

  it('extracts dependency references', () => {
    const { relationships } = parsePackageJson(BASIC_PKG, 'package.json');
    const deps = relationships.filter(r => r.kind === 'reference');
    expect(deps.length).toBe(4); // react, lodash, typescript, @my/shared
  });

  it('marks workspace deps as non-third-party', () => {
    const { relationships } = parsePackageJson(BASIC_PKG, 'package.json');
    const workspaceDep = relationships.find(r =>
      r.kind === 'reference' && r.targetEntityId === 'pkg:@my/shared',
    );
    expect(workspaceDep).toBeDefined();
    expect(workspaceDep!.thirdParty).toBe(false);
    expect(workspaceDep!.resolutionKind).toBe('proxy');
  });

  it('marks npm deps as third-party', () => {
    const { relationships } = parsePackageJson(BASIC_PKG, 'package.json');
    const npmDep = relationships.find(r =>
      r.kind === 'reference' && r.thirdParty,
    );
    expect(npmDep).toBeDefined();
    expect(npmDep!.targetEntityId).toBeNull();
    expect(npmDep!.resolutionKind).toBe('unresolved');
  });

  it('extracts script field entities', () => {
    const { entities } = parsePackageJson(BASIC_PKG, 'package.json');
    const scripts = entities.filter(e => e.kind === 'field');
    expect(scripts.length).toBe(2);
    expect(scripts.map(s => s.name).sort()).toEqual(['scripts.build', 'scripts.test']);
  });

  it('sets containment relationships for scripts', () => {
    const { relationships } = parsePackageJson(BASIC_PKG, 'package.json');
    const contains = relationships.filter(r => r.kind === 'contain');
    expect(contains.length).toBe(2);
    expect(contains.every(r => r.sourceEntityId === 'file:package.json')).toBe(true);
  });

  it('file entity has childEntityIds pointing to scripts', () => {
    const { entities } = parsePackageJson(BASIC_PKG, 'package.json');
    const file = entities.find(e => e.kind === 'file')!;
    expect(file.childEntityIds.length).toBe(2);
    expect(file.hierarchyKind).toBe('container');
  });

  it('handles malformed JSON gracefully', () => {
    const { entities, relationships } = parsePackageJson('not json', 'package.json');
    expect(entities.length).toBe(1); // still produces file entity
    expect(relationships.length).toBe(0);
  });

  it('handles package.json without deps or scripts', () => {
    const { entities, relationships } = parsePackageJson('{"name":"minimal"}', 'package.json');
    expect(entities.length).toBe(1);
    expect(relationships.length).toBe(0);
  });
});

// ── tsconfig.json ───────────────────────────────────────────────────────────

describe('parseTsConfig', () => {
  const TSCONFIG = JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: { outDir: 'dist', rootDir: 'src' },
    references: [{ path: '../shared' }, { path: '../contracts' }],
  }, null, 2);

  it('extracts file entity', () => {
    const { entities } = parseTsConfig(TSCONFIG, 'packages/app/tsconfig.json');
    const file = entities.find(e => e.kind === 'file');
    expect(file).toBeDefined();
    expect(file!.id).toBe('file:packages/app/tsconfig.json');
  });

  it('extracts extends relationship', () => {
    const { relationships } = parseTsConfig(TSCONFIG, 'packages/app/tsconfig.json');
    const ext = relationships.find(r => r.kind === 'extend');
    expect(ext).toBeDefined();
    expect(ext!.targetFilePath).toBe('../tsconfig.json');
    expect(ext!.resolutionKind).toBe('proxy');
  });

  it('extracts project references', () => {
    const { relationships } = parseTsConfig(TSCONFIG, 'packages/app/tsconfig.json');
    const refs = relationships.filter(r => r.kind === 'reference');
    expect(refs.length).toBe(2);
    expect(refs.map(r => r.targetFilePath).sort()).toEqual(['../contracts', '../shared']);
  });

  it('handles jsonc comments', () => {
    const withComments = `{
      // This is a comment
      "extends": "./base.json",
      /* block comment */
      "compilerOptions": {}
    }`;
    const { relationships } = parseTsConfig(withComments, 'tsconfig.json');
    expect(relationships.length).toBe(1);
    expect(relationships[0].kind).toBe('extend');
  });

  it('handles tsconfig without extends or references', () => {
    const minimal = '{"compilerOptions": {"strict": true}}';
    const { entities, relationships } = parseTsConfig(minimal, 'tsconfig.json');
    expect(entities.length).toBe(1);
    expect(relationships.length).toBe(0);
  });
});

// ── Generic config ──────────────────────────────────────────────────────────

describe('parseGenericConfig', () => {
  it('extracts extends from eslint config json', () => {
    const content = JSON.stringify({ extends: '@company/eslint-config' });
    const { relationships } = parseGenericConfig(content, '.eslintrc.json');
    expect(relationships.length).toBe(1);
    expect(relationships[0].kind).toBe('extend');
    expect(relationships[0].targetFilePath).toBe('@company/eslint-config');
  });

  it('skips non-json files gracefully', () => {
    const { entities, relationships } = parseGenericConfig('module.exports = {}', 'jest.config.js');
    expect(entities.length).toBe(1);
    expect(relationships.length).toBe(0);
  });

  it('handles malformed JSON', () => {
    const { entities } = parseGenericConfig('{bad json}', '.prettierrc.json');
    expect(entities.length).toBe(1);
  });
});

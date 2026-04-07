#!/usr/bin/env node
/**
 * Generate analysis-result.json for the viewer app.
 * Run from the repo root: node analysis/viewer-app/generate-data.mjs
 */
import { collect } from '../collectors/typescript/dist/index.js';
import { runStructuralPipeline } from '../structural/dist/index.js';
import { readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const srcDirs = process.argv.slice(2);
if (srcDirs.length === 0) {
  srcDirs.push(
    'packages/core/src',
    'packages/service/src',
    'packages/cli/src',
    'packages/web/src',
    'packages/api-server/src',
    'packages/fs/src',
    'packages/permission/src',
    'packages/api-client/src',
    'packages/api-client-http/src',
    'packages/vscode/src',
    'analysis/structural/src',
    'analysis/contracts/src',
  );
}

console.log(`Collecting from: ${srcDirs.join(', ')}...`);
const { data } = await collect({ srcDirs, rootDir: repoRoot });
console.log(`  ${data.entities.length} entities, ${data.relationships.length} relationships`);

function inferCodeConcern(entity) {
  if (entity.kind === 'interface' || entity.kind === 'type-alias' || entity.kind === 'enum' || entity.classification?.isTypeOnly) {
    return 'contract';
  }
  if ((entity.rawCounts?.jsxElementCount ?? 0) > 0) {
    return 'presentation';
  }
  if (entity.kind === 'function' || entity.kind === 'method' || entity.kind === 'class' || entity.kind === 'field' || entity.kind === 'property') {
    return 'logic';
  }
  return 'unknown';
}

const enrichedEntities = data.entities.map((entity) => {
  if (entity.kind === 'file') return entity;
  return {
    ...entity,
    classification: {
      ...entity.classification,
      codeConcern: entity.classification?.codeConcern ?? inferCodeConcern(entity),
    },
  };
});

function buildAugmentedRelationships(entities, relationships) {
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const nonFileByFile = new Map();
  const exportedNonFileByFile = new Map();
  for (const entity of entities) {
    if (entity.kind === 'file') continue;
    const parent = entity.parentEntityId;
    if (!parent) continue;
    if (!nonFileByFile.has(parent)) nonFileByFile.set(parent, []);
    nonFileByFile.get(parent).push(entity.id);
    if (entity.classification?.isExported) {
      if (!exportedNonFileByFile.has(parent)) exportedNonFileByFile.set(parent, []);
      exportedNonFileByFile.get(parent).push(entity.id);
    }
  }

  const proxies = [];
  const seen = new Set();
  for (const rel of relationships) {
    const source = entityById.get(rel.sourceEntityId);
    const target = entityById.get(rel.targetEntityId);
    if (!source || !target) continue;
    if (source.kind !== 'file' || target.kind !== 'file') continue;
    if (rel.kind !== 'import' && rel.kind !== 'use' && rel.kind !== 'reference' && rel.kind !== 're-export') continue;

    const sourceCandidates = exportedNonFileByFile.get(source.id) ?? nonFileByFile.get(source.id) ?? [];
    const targetCandidates = exportedNonFileByFile.get(target.id) ?? nonFileByFile.get(target.id) ?? [];
    if (sourceCandidates.length === 0 || targetCandidates.length === 0) continue;

    const sourceEntityId = sourceCandidates[0];
    for (const targetEntityId of targetCandidates) {
      const key = `${sourceEntityId}->${targetEntityId}:${rel.kind}:${rel.typeOnly ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      proxies.push({
        ...rel,
        sourceEntityId,
        targetEntityId,
        kind: 'reference',
      });
    }
  }

  return [...relationships, ...proxies];
}

const augmentedRelationships = buildAugmentedRelationships(enrichedEntities, data.relationships);
console.log(`  Augmented relationships: ${augmentedRelationships.length} (${augmentedRelationships.length - data.relationships.length} synthetic refs)`);

console.log('Running structural pipeline...');
const result = runStructuralPipeline(
  enrichedEntities,
  augmentedRelationships,
  data.moduleBoundaries,
);

const fileContents = {};
for (const file of result.fileClassifications) {
  try {
    const relPath = file.filePath.replace(/\\/g, '/');
    const abs = resolve(repoRoot, relPath);
    const source = readFileSync(abs, 'utf8');
    fileContents[file.fileId] = source;
  } catch {
    // Keep generation resilient if a file moved between collection and generation.
  }
}

const outPath = resolve(__dirname, 'public', 'analysis-result.json');

// Serialize in parts to avoid V8 string length limit with large codebases.
const fd = openSync(outPath, 'w');
const writePart = (s) => writeSync(fd, s);

// fileContents — serialize per-file to avoid one giant string
writePart('{"fileContents":{');
let firstFC = true;
for (const [key, value] of Object.entries(fileContents)) {
  if (!firstFC) writePart(',');
  firstFC = false;
  writePart(JSON.stringify(key) + ':' + JSON.stringify(value));
}
writePart('}');

// entities — serialize per-entity
writePart(',"entities":[');
for (let i = 0; i < enrichedEntities.length; i++) {
  if (i > 0) writePart(',');
  writePart(JSON.stringify(enrichedEntities[i]));
}
writePart(']');

// relationships — serialize in chunks of 500
writePart(',"relationships":[');
for (let i = 0; i < augmentedRelationships.length; i += 500) {
  const chunk = augmentedRelationships.slice(i, i + 500);
  const json = JSON.stringify(chunk);
  if (i > 0) writePart(',');
  // Strip outer [ ] and write contents
  writePart(json.slice(1, -1));
}
writePart(']');

// Spread remaining result keys (smaller data)
for (const [key, value] of Object.entries(result)) {
  if (value === undefined) continue;
  writePart(`,"${key}":`);
  writePart(JSON.stringify(value));
}
writePart('}');
closeSync(fd);
console.log(`Written to ${outPath}`);
console.log(`  Files: ${result.summary.totalFiles}, Clusters: ${result.summary.clusterCount}`);
console.log(`  Warnings: ${result.alignment.warnings.length}`);

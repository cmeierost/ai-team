#!/usr/bin/env node
/**
 * Generate analysis-result.json for the viewer app.
 * Run from the repo root: node analysis/viewer-app/generate-data.mjs
 */
import { collect } from '../collectors/typescript/dist/index.js';
import { runStructuralPipeline } from '../structural/dist/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
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

console.log('Running structural pipeline...');
const result = runStructuralPipeline(
  data.entities,
  data.relationships,
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
writeFileSync(outPath, JSON.stringify({ ...result, fileContents }, null, 2));
console.log(`Written to ${outPath}`);
console.log(`  Files: ${result.summary.totalFiles}, Clusters: ${result.summary.clusterCount}`);
console.log(`  Warnings: ${result.alignment.warnings.length}`);

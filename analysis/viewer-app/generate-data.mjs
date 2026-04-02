#!/usr/bin/env node
/**
 * Generate analysis-result.json for the viewer app.
 * Run from the repo root: node analysis/viewer-app/generate-data.mjs
 */
import { collect } from '../collectors/typescript/dist/index.js';
import { analyze } from '../engine/dist/index.js';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const srcDirs = process.argv.slice(2);
if (srcDirs.length === 0) {
  srcDirs.push('packages/core/src');
}

console.log(`Collecting from: ${srcDirs.join(', ')}...`);
const { data } = await collect({ srcDirs, rootDir: '.' });
console.log(`  ${data.entities.length} entities, ${data.relationships.length} relationships`);

console.log('Analyzing...');
const result = await analyze({
  entities: data.entities,
  relationships: data.relationships,
  moduleBoundaries: data.moduleBoundaries,
  duplicationSignals: data.duplicationSignals,
});

const outPath = resolve(__dirname, 'public', 'analysis-result.json');
writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`Written to ${outPath}`);
console.log(`  Health: ${result.summary.healthScore}/100`);
console.log(`  Recommendations: ${result.summary.recommendationCount}`);
console.log(`  Groups: ${result.groupCoupling?.profiles.length ?? 0}`);

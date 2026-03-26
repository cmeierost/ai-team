import { getFileTree } from "../packages/fs/dist/file-tree.js";
import { performance } from "node:perf_hooks";

const runs = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  const tree = await getFileTree(process.cwd(), { maxDepth: 4, includeHidden: false, ignoreGitignore: false });
  const t1 = performance.now();
  runs.push(t1 - t0);
  if (!tree || typeof tree !== 'object') {
    throw new Error('unexpected tree result');
  }
}

const sorted = [...runs].sort((a, b) => a - b);
const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
const median = sorted[Math.floor(sorted.length / 2)];
const min = sorted[0];
const max = sorted[sorted.length - 1];

console.log('runs_ms=' + runs.map(v => v.toFixed(2)).join(', '));
console.log('avg_ms=' + avg.toFixed(2));
console.log('median_ms=' + median.toFixed(2));
console.log('min_ms=' + min.toFixed(2));
console.log('max_ms=' + max.toFixed(2));

import { PermissionEngine } from "./packages/permission/dist/engine.js";
import { performance } from "node:perf_hooks";

const runs = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  const engine = new PermissionEngine({ workspaceRoot: process.cwd(), autoLoadWorkspaceConventions: true });
  const t1 = performance.now();
  runs.push(t1 - t0);
  if (!engine) throw new Error('engine not created');
}

const sorted = [...runs].sort((a,b)=>a-b);
const avg = runs.reduce((a,b)=>a+b,0)/runs.length;
console.log('engine_init_runs_ms=' + runs.map(v => v.toFixed(2)).join(', '));
console.log('engine_init_avg_ms=' + avg.toFixed(2));
console.log('engine_init_median_ms=' + sorted[Math.floor(sorted.length/2)].toFixed(2));

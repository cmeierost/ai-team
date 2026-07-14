# @aspect/structural

Structural analysis pipeline for architecture diagnostics and actionable recommendations.

## What it provides

- File/content classification
- Dependency-weighted community detection
- Folder/package alignment metrics
- Warnings + recommendations
- Shallowness diagnostics
- **LLM priority reader** (`buildLlmPriorityReader`) for compact fix queues

## Install / build

From repo root:

- `pnpm --filter @aspect/structural build`

## Usage

```ts
import { collect } from '@aspect/collector-typescript';
import { runStructuralPipeline, buildLlmPriorityReader } from '@aspect/structural';

const { data } = await collect({ srcDirs: ['packages/service/src'], rootDir: process.cwd() });

const result = runStructuralPipeline(data.entities, data.relationships, data.moduleBoundaries);

const queue = buildLlmPriorityReader(result, { maxItems: 8 });

console.log('Fix now:', queue.current);
console.log('Then:', queue.next);
```

## LLM priority reader

`buildLlmPriorityReader(result, options)` turns a large structural result into a compact ranked queue.

### Inputs

- `result: StructuralPipelineResult`
- `options?: { maxItems?: number }` (default: `8`)

### Output

- `generatedAt`: ISO timestamp
- `healthScore`: copied from structural result when available
- `issueCount`: number of returned issues
- `current`: most important issue to fix now
- `next`: remaining issues in descending priority/impact order

Issue fields include:

- `source`: `recommendation | shallowness | warning`
- `priority`: `critical | high | medium | low`
- `category`, `title`, `action`, `rationale`
- `filePaths`
- `score` (ranking score)

## Notes

- The reader is designed for iterative remediation loops:
  1. pick `current`
  2. fix it
  3. rerun analysis
  4. continue with new `current`
- For best folder-vs-relation quality, ensure your collector run captures representative source directories.

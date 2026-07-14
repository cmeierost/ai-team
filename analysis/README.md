# Aspect — Architecture Analysis System

Static analysis toolchain that extracts raw facts from source code and computes
architecture-quality metrics. Language-agnostic by design: collectors produce a
shared intermediate representation; pipelines and calculators consume it.

## Three-Layer Architecture

```text
 Collectors              Contracts              Pipelines + Calculators
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ TypeScript   │──▶│ CollectedCodeData│──▶│ Structural       │
│  AST visitor │   │ (JSON Schema)    │   │  pipeline        │
│  dep-cruiser │   │                  │   │  clustering      │
│  jscpd       │   │ Protocol         │   │  alignment       │
│  eslint      │   │  framed stdio    │   │  recommendations │
│  coverage    │   │ AnalyzedCodeData │   │ Complexity       │
└──────────────┘   └──────────────────┘   │ Duplication      │
  Future:                                 │ SOLID + LCOM4    │
  C#, Java, …                             ├──────────────────┤
                                          │ Viewer           │
                                          │  React UI        │
                                          └──────────────────┘
```

| Package                                                    | Description                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`@aspect/contracts`](./contracts/)                        | Technology-agnostic JSON Schema contracts, generated types, validators, binary framing               |
| [`@aspect/collector-typescript`](./collectors/typescript/) | TypeScript/JavaScript fact extractor using AST visitors, dependency-cruiser, jscpd, eslint, coverage |
| [`@aspect/collector-css`](./collectors/css/)               | CSS fact extractor                                                                                   |
| [`@aspect/collector-config`](./collectors/config/)         | Config file fact extractor                                                                           |
| [`@aspect/collector-markdown`](./collectors/markdown/)     | Markdown/documentation fact extractor                                                                |
| [`@aspect/collector-shared`](./collectors/shared/)         | Shared collector utilities                                                                           |
| [`@aspect/complexity`](./complexity/)                      | Cyclomatic, cognitive, and Halstead complexity calculators                                           |
| [`@aspect/duplication`](./duplication/)                    | Code duplication detection and metrics                                                               |
| [`@aspect/solid`](./solid/)                                | SOLID indicators and LCOM4 cohesion                                                                  |
| [`@aspect/structural`](./structural/)                      | Structural pipeline (classification, clustering, alignment, recommendations)                         |
| [`@aspect/viewer`](./viewer/)                              | React component library for visualizing analysis results                                             |
| [`@aspect/viewer-app`](./viewer-app/)                      | Standalone viewer app for analysis output                                                            |

## Quick Start (Structural Pipeline)

```ts
import { collect } from '@aspect/collector-typescript';
import { runStructuralPipeline } from '@aspect/structural';

// 1. Collect raw facts
const { data } = await collect({ rootDir: './my-project' });

// 2. Analyze (structural pipeline)
const result = runStructuralPipeline(data.entities, data.relationships, data.moduleBoundaries);
```

## Quick Start (LLM Priority Reader)

Use the priority reader to get a compact, ordered action queue for an LLM:

```ts
import { collect } from '@aspect/collector-typescript';
import { runStructuralPipeline, buildLlmPriorityReader } from '@aspect/structural';

const { data } = await collect({ srcDirs: ['packages/service/src'], rootDir: process.cwd() });
const result = runStructuralPipeline(data.entities, data.relationships, data.moduleBoundaries);

const queue = buildLlmPriorityReader(result, { maxItems: 8 });

// queue.current = most important issue to fix now
// queue.next    = follow-up issues in priority order
console.log(JSON.stringify(queue, null, 2));
```

Reader output shape (simplified):

```json
{
  "generatedAt": "...",
  "healthScore": 55,
  "issueCount": 8,
  "current": {
    "id": "warning:file-too-large:...",
    "source": "warning",
    "priority": "critical",
    "title": "...",
    "action": "...",
    "rationale": "...",
    "filePaths": ["..."],
    "score": 500
  },
  "next": [{ "id": "...", "priority": "critical", "action": "..." }]
}
```

## Viewer App Pipeline Example

The viewer app ships a runnable script that collects data and runs the
structural pipeline to generate `analysis-result.json`:

- [`analysis/viewer-app/generate-data.mjs`](./viewer-app/generate-data.mjs)

Run it from the repo root after building the analysis packages:

```bash
pnpm -r build
node analysis/viewer-app/generate-data.mjs
```

## Building

```bash
pnpm install
pnpm -r build          # builds contracts → collectors → calculators → viewer
```

## Fuzzy Duplication Scan (feature + cleanup gate)

When implementing a new feature or performing cleanup/refactor work, run the fuzzy duplication detector for the changed scope and review hotspots before finishing.

```bash
pnpm --filter @aspect/duplication build
node analysis/duplication/dist/cli/fuzzy-dup.js <scope> --format text
```

Examples:

```bash
node analysis/duplication/dist/cli/fuzzy-dup.js packages/service --match-length 12 --fuzz 2 --gap-tolerance 1 --max-hole-size 1
node analysis/duplication/dist/cli/fuzzy-dup.js packages --format json
```

## Adding a New Language Collector

1. Implement adapters that extract `Entity[]`, `Relationship[]`, and signals
2. Assemble output as `CollectedCodeData` (validated by `@aspect/contracts`)
3. Pipelines consume the data unchanged — no pipeline modifications needed

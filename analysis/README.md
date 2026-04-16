# Aspect — Architecture Analysis System

Static analysis toolchain that extracts raw facts from source code and computes
architecture-quality metrics. Language-agnostic by design: collectors produce a
shared intermediate representation; the engine consumes it.

## Three-Layer Architecture

```
 Collectors              Contracts              Engine
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ TypeScript   │──▶│ CollectedCodeData│──▶│ Calculators      │
│  AST visitor │   │ (JSON Schema)    │   │  complexity      │
│  dep-cruiser │   │                  │   │  coupling        │
│  jscpd       │   │ Protocol         │   │  graph metrics   │
│  eslint      │   │  framed stdio    │   │  cohesion (LCOM4)│
│  coverage    │   │                  │   │  SOLID indicators│
└──────────────┘   │ AnalyzedCodeData │   │  duplication     │
                   └──────────────────┘   │  module metrics  │
  Future:                                 ├──────────────────┤
  C#, Java, …                             │ Exporters        │
                                          │  JSON · SARIF    │
                                          │  DOT · GraphML   │
                                          │  SonarQube       │
                                          └──────────────────┘
```

| Package | Description |
|---------|-------------|
| [`@aspect/contracts`](./contracts/) | Technology-agnostic JSON Schema contracts, generated types, validators, binary framing |
| [`@aspect/engine`](./engine/) | Calculators, orchestrator (`analyze()`), output exporters, CLI (`aspect-analyze`) |
| [`@aspect/collector-typescript`](./collectors/typescript/) | TypeScript/JavaScript fact extractor using AST visitors, dependency-cruiser, jscpd, eslint, coverage |

## Quick Start

```ts
import { collect } from '@aspect/collector-typescript';
import { analyze } from '@aspect/engine';
import { toSarif } from '@aspect/engine';

// 1. Collect raw facts
const { data } = await collect({ rootDir: './my-project' });

// 2. Analyze
const result = await analyze({
  entities: data.entities,
  relationships: data.relationships,
  moduleBoundaries: data.moduleBoundaries,
  duplicationSignals: data.duplicationSignals,
});

// 3. Export
const sarif = toSarif(result, {
  entities: data.entities,
  relationships: data.relationships,
  moduleBoundaries: data.moduleBoundaries,
});
```

## CLI

The engine ships a CLI binary `aspect-analyze` that runs the full
collect → analyze → export pipeline:

```bash
# JSON output (default)
aspect-analyze --root ./my-project

# SARIF for CI integration
aspect-analyze --root ./my-project -f sarif -o report.sarif

# Only specific calculators
aspect-analyze --root ./my-project --include complexity,coupling

# Graphviz dependency graph
aspect-analyze --root ./my-project -f dot -o deps.dot
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-r, --root <dir>` | Project root directory |
| `--src <dirs>` | Comma-separated source directories (default: `src`) |
| `-f, --format <fmt>` | Output format: `json`, `sarif`, `dot`, `graphml`, `sonarqube` |
| `-o, --output <file>` | Output file (default: stdout) |
| `--include <groups>` | Calculator groups to run (comma-separated) |
| `--aspects <names>` | Collection aspects to run |
| `--modules <file>` | Module boundary definitions (JSON) |
| `--coverage <path>` | Coverage report path (LCOV or Istanbul) |
| `--no-third-party` | Exclude third-party dependencies |
| `--no-type-only` | Exclude type-only imports |
| `-q, --quiet` | Suppress progress output |

## Building

```bash
pnpm install
pnpm -r build          # builds contracts → collector → engine
```

## Adding a New Language Collector

1. Implement adapters that extract `Entity[]`, `Relationship[]`, and signals
2. Assemble output as `CollectedCodeData` (validated by `@aspect/contracts`)
3. The engine consumes the data unchanged — no engine modifications needed

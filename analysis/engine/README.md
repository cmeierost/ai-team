# @aspect/engine

Technology-agnostic calculation engine for the Aspect analysis system.
Takes `CollectedCodeData` from any language collector and produces architecture
quality metrics, then exports results in multiple formats.

## Calculators

Seven independent calculators, each operating on the shared contract types:

| Calculator | Function | Computes |
|------------|----------|----------|
| Complexity | `calculateComplexity(entities)` | Cyclomatic, cognitive, and Halstead metrics per function |
| Coupling | `calculateCoupling(entities, rels, opts?)` | Afferent/efferent coupling, instability per entity |
| Graph | `calculateGraphMetrics(entities, rels)` | Cycles (Tarjan), betweenness centrality, PageRank, communities (Louvain) |
| Cohesion | `calculateLcom4(entityId, matrix)` | LCOM4 — connected components of method–field access |
| SOLID | `calculateSolidIndicators(entities, rels, modules, lcom4)` | Heuristic [0,1] scores for SRP, OCP, LSP, ISP, DIP |
| Duplication | `calculateDuplication(signals, entities, modules, opts?)` | Per-file, project-level, and cross-module duplication |
| Module | `calculateModuleMetrics(entities, rels, modules)` | Abstractness, instability, distance from main sequence |

## Orchestrator

The `analyze()` function runs selected calculators, aggregates timing, and
builds a summary with top-5 rankings:

```ts
import { analyze } from '@aspect/engine';

const result = await analyze(
  {
    entities: collectedData.entities,
    relationships: collectedData.relationships,
    moduleBoundaries: collectedData.moduleBoundaries,
    duplicationSignals: collectedData.duplicationSignals,
  },
  { include: ['complexity', 'coupling', 'solid'] },
);

console.log(result.summary.maxCyclomaticComplexity);
console.log(result.timing.perCalculator);
```

**`AnalysisOptions`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `include` | `CalculatorGroup[]` | all | Which calculators to run |
| `couplingOptions` | `CouplingOptions` | — | Filter third-party, type-only, dynamic edges |
| `hotspotCount` | `number` | `10` | Top-N duplication hotspots |

`CalculatorGroup`: `'complexity'` · `'coupling'` · `'graph'` · `'cohesion'` · `'solid'` · `'duplication'` · `'module'`

## Output Exporters

| Exporter | Function | Format |
|----------|----------|--------|
| JSON | `toJson(result, opts?)` | Filtered JSON with optional section selection |
| SARIF | `toSarif(result, collected)` | SARIF v2.1.0 for GitHub/VS Code integration |
| DOT | `toDot(result, collected, opts?)` | Graphviz DOT — cycle highlighting, community colours |
| GraphML | `toGraphML(result, collected)` | GraphML for yEd, Gephi |
| SonarQube | `toSonarQube(result, collected)` | SonarQube Generic Issue Data format |

```ts
import { toSarif, toDot, toJson } from '@aspect/engine';

// SARIF — flags high complexity, cycles, low SRP
const sarif = toSarif(result, collected);

// DOT — colour nodes by community, size by complexity
const dot = toDot(result, collected, {
  colorByCommunity: true,
  sizeByMetric: 'complexity',
  highlightCycles: true,
});

// JSON — specific sections only
const json = toJson(result, { sections: ['complexity', 'summary'] });
```

## CLI

The `aspect-analyze` binary runs the full collect → analyze → export pipeline:

```bash
aspect-analyze --root ./project -f sarif -o report.sarif
aspect-analyze --root ./project --include complexity,coupling -f json
aspect-analyze --root ./project -f dot -o deps.dot
```

See the [top-level README](../README.md) for the full flag reference.

## Metrics Reference

### Complexity

| Metric | Formula | Source |
|--------|---------|--------|
| Cyclomatic | `branchPoints + 1` | McCabe 1976 |
| Cognitive | `Σ(increment + nesting depth)` | SonarSource |
| Halstead Volume | `N × log₂(η)` where N = total operators+operands, η = distinct |
| Halstead Difficulty | `(η₁/2) × (N₂/η₂)` |
| Halstead Effort | `Difficulty × Volume` |
| Estimated Bugs | `Volume / 3000` |

### Coupling

| Metric | Formula |
|--------|---------|
| Afferent (Ca) | Incoming dependency count |
| Efferent (Ce) | Outgoing dependency count |
| Instability (I) | `Ce / (Ca + Ce)` — 0 = maximally stable |
| Module Cohesion | `internal edges / (internal + external edges)` |

### Module (Martin's Metrics)

| Metric | Formula |
|--------|---------|
| Abstractness (A) | `(abstract + interface) / total type entities` |
| Instability (I) | `Ce / (Ca + Ce)` |
| Distance (D) | `\|A + I − 1\|` — 0 = on main sequence |
| Zone of Pain | `A < 0.2` and `I < 0.2` (concrete + stable = hard to change) |
| Zone of Uselessness | `A > 0.8` and `I > 0.8` (abstract + unstable = unused) |

### SOLID Indicators (heuristic scores 0–1)

| Principle | Key Inputs | Score Logic |
|-----------|-----------|-------------|
| SRP | LCOM4, import diversity | `(1/max(lcom4,1)) × diversityPenalty` |
| OCP | Type checks, extension points, concrete targets | `0.4×typeCheck + 0.3×extension + 0.3×concrete` |
| ISP | Consumer member usage ratios | Average usage ratio |
| DIP | Abstraction dependency ratio | Ratio of abstract dependencies |
| LSP | Override signature mismatches | `1 − (mismatches × 0.2)` |

### Graph

| Metric | Algorithm |
|--------|-----------|
| Cycle detection | Tarjan's SCC |
| Betweenness centrality | Brandes (normalized) |
| PageRank | Power iteration (α=0.85, 100 iterations, ε=1e-6) |
| Community detection | Louvain on undirected projection |

## Building

```bash
pnpm build           # tsc
pnpm test            # vitest
```

# @aspect/collector-typescript

Extracts raw architectural facts from TypeScript and JavaScript projects.
Produces `CollectedCodeData` conforming to the `@aspect/contracts` schema,
ready for consumption by `@aspect/structural` and the calculator packages.

## Adapters

Five adapters run in parallel, each extracting a different facet:

| Adapter            | Function                     | Extracts                                                                                                                                            |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| AST Visitor        | `runAstVisitor(opts)`        | Entities (classes, functions, interfaces, enums), raw counts (LOC, branch points, Halstead operands/operators, nesting), method–field access matrix |
| Dependency Cruiser | `runDepCruiserAdapter(opts)` | File entities, import relationships with flags (thirdParty, crossModule, typeOnly, dynamic, circular)                                               |
| jscpd              | `runJscpdAdapter(opts)`      | Clone pairs — file locations, token/line counts, duplication statistics                                                                             |
| ESLint             | `runEslintAdapter(opts)`     | Lint violations — ruleId, severity, message, source location                                                                                        |
| Coverage           | `runCoverageAdapter(opts)`   | Per-file line/branch coverage, per-function execution counts (LCOV and Istanbul formats)                                                            |

### What Each Adapter Produces

**AST Visitor** — The core adapter. For every file, class, function, method,
interface, type alias, and enum it records:

- Entity kind, name, visibility, export status, abstract/interface/concrete
- Lines of code, parameter count, return statements, branch points
- Nesting contributions (depth + increment pairs for cognitive complexity)
- Halstead operators/operands (distinct + total counts)
- Type-checking patterns (instanceof, typeof, switch)
- Public method/property counts, extension points, overridden methods
- Method → field access matrix (input for LCOM4 cohesion)

**Dependency Cruiser** — Walks `import`/`require` statements and classifies each
edge: third-party, cross-module, cross-package, type-only, dynamic.
Assigns files to named modules when `moduleBoundaries` are provided.

**jscpd** — Copy-paste detection. Reports clone pairs with exact start/end
locations, token counts, and aggregate duplication percentage.

**ESLint** — Runs the project's ESLint configuration and normalises violations
into the `LintSignal` schema.

**Coverage** — Parses LCOV (`.lcov`) or Istanbul JSON coverage reports. Records
line/branch totals and per-function execution counts.

## Orchestrator

The `collect()` function discovers source files, runs selected adapters, merges
results, and assembles the final `CollectedCodeData`:

```ts
import { collect } from '@aspect/collector-typescript';

const { data, timing, warnings } = await collect({
  rootDir: './my-project',
  srcDirs: ['src', 'lib'],
  include: ['**/*.ts', '**/*.tsx'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  moduleBoundaries: [
    { moduleId: 'core', modulePath: 'src/core' },
    { moduleId: 'api', modulePath: 'src/api' },
  ],
  coveragePath: 'coverage/lcov.info',
  jscpd: { minTokens: 50, minLines: 5 },
});

console.log(data.entities.length, 'entities');
console.log(timing.perAspect); // { entityExtraction: 150, dependencyGraph: 200, … }
```

### Collection Aspects

Control which adapters run with `includeAspects` / `excludeAspects`:

| Aspect             | Adapter            |
| ------------------ | ------------------ |
| `entityExtraction` | AST Visitor        |
| `dependencyGraph`  | Dependency Cruiser |
| `duplication`      | jscpd              |
| `lint`             | ESLint             |
| `coverage`         | Coverage           |

```ts
// Only entities and dependencies
await collect({
  rootDir: '.',
  includeAspects: ['entityExtraction', 'dependencyGraph'],
});

// Everything except lint
await collect({
  rootDir: '.',
  excludeAspects: ['lint'],
});
```

## Configuration

**`CollectorOptions`:**

| Option                    | Type                         | Default                                | Description                        |
| ------------------------- | ---------------------------- | -------------------------------------- | ---------------------------------- |
| `rootDir`                 | `string`                     | —                                      | **Required.** Project root         |
| `srcDirs`                 | `string[]`                   | `['src']`                              | Source directories to scan         |
| `include`                 | `string[]`                   | `['**/*.ts', '**/*.tsx']`              | File glob patterns                 |
| `exclude`                 | `string[]`                   | `['**/node_modules/**', '**/dist/**']` | Exclusion globs                    |
| `includeAspects`          | `CollectionAspect[]`         | all                                    | Aspects to run                     |
| `excludeAspects`          | `CollectionAspect[]`         | none                                   | Aspects to skip                    |
| `moduleBoundaries`        | `{ moduleId, modulePath }[]` | —                                      | Module definitions                 |
| `coveragePath`            | `string`                     | —                                      | Path to coverage report            |
| `coverageFormat`          | `'lcov' \| 'istanbul'`       | auto-detected                          | Coverage report format             |
| `jscpd.minTokens`         | `number`                     | `50`                                   | Minimum tokens for clone detection |
| `jscpd.minLines`          | `number`                     | `5`                                    | Minimum lines for clone detection  |
| `eslint.configPath`       | `string`                     | —                                      | ESLint config file path            |
| `eslint.extraArgs`        | `string[]`                   | —                                      | Additional ESLint CLI flags        |
| `depCruiser.extraOptions` | `Record<string, unknown>`    | —                                      | Extra dependency-cruiser options   |

## Output

`collect()` returns a `CollectionResult`:

```ts
interface CollectionResult {
  data: CollectedCodeData; // Validated against @aspect/contracts schema
  timing: {
    totalMs: number;
    perAspect: Record<string, number>;
  };
  warnings: string[];
}
```

The `data.collector` metadata records tool versions and aspect durations
in `data.provenance.toolRuns`.

Use the returned `data` with `runStructuralPipeline()` or the individual
calculator libraries (complexity, duplication, SOLID/cohesion).

## Building

```bash
pnpm build           # tsc
pnpm test            # vitest
```

## One-line method analyzer (wrapper smell detector)

Detects class methods whose body is a single statement, with specific labeling for forwarders:

- `single-statement` — one statement body (potentially suspicious)
- `forwarder` — one statement that returns `this.otherMethod(...)`
- `passthrough-forwarder` — a forwarder that passes parameters through unchanged

It also reports:

- target usage count (within the analyzed root)
- package relation (`same-file`, `same-package`, `other-package`, `unknown`)
- interface contract signal (`required`, `not-required`, `unknown`)
- inline urgency recommendation (`high`, `medium`, `low`, `avoid`)

Rule of thumb encoded in the analyzer:

- same package + passthrough + used once ⇒ highest urgency inline candidate
- other package target ⇒ `avoid` (not recommended to inline across package boundaries)
- interface-required wrapper ⇒ deprioritize (adapter pattern may be intentional)
- interface-required + multi-use inner target ⇒ consider direct implementation usage behind interface where safe, if dependency-cycle constraints allow

Build first, then run:

```bash
pnpm --filter @aspect/collector-typescript build
pnpm --filter @aspect/collector-typescript one-line-methods -- packages/service --kind passthrough-forwarder
```

JSON output for tooling:

```bash
pnpm --filter @aspect/collector-typescript one-line-methods -- packages/service --format json
```

# @aspect/contracts

Technology-agnostic JSON Schema contracts for the Aspect analysis system.
Defines the intermediate representation that collectors produce and the engine
consumes, plus a binary framing protocol for stdio communication.

## Schemas

Eleven schemas organised in three groups:

### Common (shared building blocks)

| Schema | File | Defines |
|--------|------|---------|
| Source Range | `common/source-range.schema.json` | Line/column source locations |
| Entity | `common/entity.schema.json` | Code constructs — files, classes, functions, etc. |
| Relationship | `common/relationship.schema.json` | Typed edges between entities (import, call, extend, …) |
| Module Boundary | `common/module-boundary.schema.json` | Architectural module definitions |
| Provenance | `common/provenance.schema.json` | Collection metadata, tool runs, timing |

### Signals (optional enrichment data)

| Schema | File | Defines |
|--------|------|---------|
| Coverage | `signals/coverage.schema.json` | Per-file/function coverage (LCOV, Istanbul) |
| Duplication | `signals/duplication.schema.json` | Clone pairs from copy-paste detection |
| Lint | `signals/lint.schema.json` | Static-analysis violations |

### Root schemas

| Schema | File | Defines |
|--------|------|---------|
| Collected Data | `collected-data.schema.json` | Full collector output (entities + relationships + signals) |
| Analyzed Data | `analyzed-data.schema.json` | Engine output (metrics, scores, summaries) |
| Protocol | `protocol.schema.json` | Stdio message types (invoke, progress, chunk, result, error, complete) |

## Generated Types

TypeScript types are generated from the JSON Schemas — schemas are the source
of truth.

```bash
pnpm generate        # npx tsx scripts/generate-types.ts
```

This writes eleven files into `src/generated/` plus a barrel `index.ts`.
The `prebuild` script runs generation automatically before `pnpm build`.

Key generated types:

```ts
import type {
  Entity,
  Relationship,
  ModuleBoundary,
  CollectedCodeData,
  AnalyzedCodeData,
  AspectProtocolMessage,
  DuplicationSignal,
  CoverageSignal,
  LintSignal,
} from '@aspect/contracts';
```

## Runtime Validation

AJV-powered validators with type narrowing:

```ts
import {
  validateCollectedData,
  getCollectedDataErrors,
  validateProtocolMessage,
  getProtocolMessageErrors,
} from '@aspect/contracts';

if (validateCollectedData(parsed)) {
  // parsed is CollectedCodeData
  console.log(parsed.entities.length, 'entities');
} else {
  console.error(getCollectedDataErrors());
}
```

| Function | Returns | Purpose |
|----------|---------|---------|
| `validateCollectedData(data)` | `data is CollectedCodeData` | Validate collector output |
| `getCollectedDataErrors()` | `string \| null` | Human-readable errors from last validation |
| `validateProtocolMessage(data)` | `data is AspectProtocolMessage` | Validate protocol messages |
| `getProtocolMessageErrors()` | `string \| null` | Errors from last protocol validation |

Validators are configured with `allErrors: true` and format support via
`ajv-formats`.

## Protocol Framing

Length-prefixed binary codec for streaming JSON over stdio:

```
┌─────────────────┬──────────────────────┐
│ 4-byte BE uint32│ UTF-8 JSON payload   │
│ (payload length)│                      │
└─────────────────┴──────────────────────┘
```

```ts
import { encodeFrame, FrameDecoder, HEADER_SIZE, MAX_PAYLOAD_SIZE } from '@aspect/contracts';

// Encode
const buf = encodeFrame({ type: 'progress', message: 'Scanning…' });
process.stdout.write(buf);

// Decode (streaming, handles partial reads)
const decoder = new FrameDecoder();
process.stdin.on('data', (chunk) => {
  const messages = decoder.push(chunk);
  for (const msg of messages) {
    handleMessage(msg);
  }
});
```

| Export | Description |
|--------|-------------|
| `encodeFrame(message)` | Returns `Buffer` with length header + JSON payload |
| `FrameDecoder` | Stateful streaming decoder; `push(buf)` returns complete messages |
| `HEADER_SIZE` | `4` bytes |
| `MAX_PAYLOAD_SIZE` | 64 MB safety limit |

## Adding Schemas for New Languages

1. Create the JSON Schema file under `schemas/` (follow existing `$id` conventions)
2. Add a mapping entry in `scripts/generate-types.ts`
3. Run `pnpm generate` to produce the TypeScript type
4. If the schema needs runtime validation, register it in `src/validators.ts`
5. Re-export the new type from `src/generated/index.ts` (auto-generated barrel)

## Building

```bash
pnpm build           # generate types + compile
pnpm test            # vitest
```

Schemas are also available as raw JSON via the subpath export:

```ts
import schema from '@aspect/contracts/schemas/collected-data.schema.json';
```

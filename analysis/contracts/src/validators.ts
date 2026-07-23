/**
 * Pre-compiled ajv validators for runtime validation of collected data and
 * protocol messages. Uses generated types for type narrowing.
 */
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CollectedCodeData } from './generated/collected-data.js';
import type { AspectProtocolMessage } from './generated/protocol.js';
import type { ReferenceGraphSignal } from './generated/reference-graph.js';

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
// Works from both src/ (tsx) and dist/ (compiled) — both are one level below the package root
const packageRoot = join(__dirname, '..');
const schemasDir = join(packageRoot, 'schemas');

function loadSchema(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(schemasDir, relativePath), 'utf-8'));
}

// Common schemas
const sourceRangeSchema = loadSchema('common/source-range.schema.json');
const entitySchema = loadSchema('common/entity.schema.json');
const relationshipSchema = loadSchema('common/relationship.schema.json');
const moduleBoundarySchema = loadSchema('common/module-boundary.schema.json');
const provenanceSchema = loadSchema('common/provenance.schema.json');
const fileInventorySchema = loadSchema('common/file-inventory.schema.json');

// Signal schemas
const duplicationSchema = loadSchema('signals/duplication.schema.json');
const coverageSchema = loadSchema('signals/coverage.schema.json');
const lintSchema = loadSchema('signals/lint.schema.json');
const referenceGraphSchema = loadSchema('signals/reference-graph.schema.json');

// Root schemas
const collectedDataSchema = loadSchema('collected-data.schema.json');
const protocolSchema = loadSchema('protocol.schema.json');

// ---------------------------------------------------------------------------
// ajv instance
// ---------------------------------------------------------------------------

const ajv = new Ajv({
  allErrors: true,
  strict: false, // allow draft-07 features without warnings
});
addFormats(ajv);

// Register all sub-schemas so that $ref resolution works when compiling root
// schemas.  ajv uses each schema's $id (e.g. "https://aspect.dev/schemas/...")
// for URI-based $ref resolution, which matches how the schemas reference each
// other (relative $ref strings resolved against the referencing schema's $id).
ajv.addSchema(sourceRangeSchema);
ajv.addSchema(entitySchema);
ajv.addSchema(relationshipSchema);
ajv.addSchema(moduleBoundarySchema);
ajv.addSchema(provenanceSchema);
ajv.addSchema(fileInventorySchema);
ajv.addSchema(duplicationSchema);
ajv.addSchema(coverageSchema);
ajv.addSchema(lintSchema);
ajv.addSchema(referenceGraphSchema);

// ---------------------------------------------------------------------------
// Compiled validators
// ---------------------------------------------------------------------------

const validateCollectedDataFn: ValidateFunction = ajv.compile(collectedDataSchema);
const validateProtocolFn: ValidateFunction = ajv.compile(protocolSchema);
const validateReferenceGraphFn: ValidateFunction = ajv.compile(referenceGraphSchema);

// ---------------------------------------------------------------------------
// Public API — type-narrowing validators
// ---------------------------------------------------------------------------

/** Validates that `data` conforms to the CollectedCodeData schema. */
export function validateCollectedData(data: unknown): data is CollectedCodeData {
  return validateCollectedDataFn(data) as boolean;
}

/** Returns a human-readable error string from the last `validateCollectedData` call, or `null`. */
export function getCollectedDataErrors(): string | null {
  if (!validateCollectedDataFn.errors?.length) return null;
  return ajv.errorsText(validateCollectedDataFn.errors);
}

/** Validates that `data` conforms to the Aspect Protocol Message schema. */
export function validateProtocolMessage(data: unknown): data is AspectProtocolMessage {
  return validateProtocolFn(data) as boolean;
}

/** Returns a human-readable error string from the last `validateProtocolMessage` call, or `null`. */
export function getProtocolMessageErrors(): string | null {
  if (!validateProtocolFn.errors?.length) return null;
  return ajv.errorsText(validateProtocolFn.errors);
}

/** Validates that `data` conforms to the ReferenceGraphSignal schema. */
export function validateReferenceGraphSignal(data: unknown): data is ReferenceGraphSignal {
  return validateReferenceGraphFn(data) as boolean;
}

/** Returns a human-readable error string from the last `validateReferenceGraphSignal` call, or `null`. */
export function getReferenceGraphSignalErrors(): string | null {
  if (!validateReferenceGraphFn.errors?.length) return null;
  return ajv.errorsText(validateReferenceGraphFn.errors);
}

// Re-export internals for advanced usage
export { validateCollectedDataFn, validateProtocolFn, validateReferenceGraphFn, ajv };

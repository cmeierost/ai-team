import { describe, it, expect } from 'vitest';
import {
  validateCollectedData,
  validateProtocolMessage,
  getCollectedDataErrors,
  getProtocolMessageErrors,
} from './validators.js';
import type { CollectedCodeData } from './generated/collected-data.js';
import type {
  AspectProtocolMessage,
  InvokeMessage,
  ResultMessage,
  ErrorMessage,
} from './generated/protocol.js';
import type { Entity } from './generated/entity.js';
import type { Relationship } from './generated/relationship.js';

// ---------------------------------------------------------------------------
// Fixture helpers — minimal valid objects matching the JSON Schema
// ---------------------------------------------------------------------------

function makeSourceRange() {
  return { startLine: 1, startColumn: 0, endLine: 10, endColumn: 0 };
}

function makeEntity(overrides?: Partial<Entity>): Entity {
  return {
    id: 'file:src/index.ts',
    kind: 'file',
    name: 'index.ts',
    filePath: 'src/index.ts',
    sourceRange: makeSourceRange(),
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: false,
      visibility: null,
    },
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root',
    ...overrides,
  };
}

function makeRelationship(overrides?: Partial<Relationship>): Relationship {
  return {
    sourceEntityId: 'file:src/index.ts',
    targetEntityId: 'file:src/utils.ts',
    kind: 'import',
    sourceRange: makeSourceRange(),
    sourceFilePath: 'src/index.ts',
    resolutionKind: 'resolved',
    targetClassification: 'unknown',
    targetIsAbstraction: false,
    crossModule: false,
    crossPackage: false,
    thirdParty: false,
    typeOnly: false,
    dynamic: false,
    ...overrides,
  };
}

function makeCollectedData(overrides?: Partial<CollectedCodeData>): CollectedCodeData {
  return {
    schemaVersion: '1.0',
    collectedAt: new Date().toISOString(),
    collector: {
      id: '@aspect/collector-typescript',
      version: '0.1.0',
      language: 'typescript',
      tools: ['ts-morph'],
    },
    entities: [makeEntity()],
    relationships: [makeRelationship()],
    moduleBoundaries: [],
    fileInventory: [],
    provenance: {
      collectionDuration: 100,
      toolRuns: [],
    },
    ...overrides,
  };
}

function makeInvokeMessage(): InvokeMessage {
  return {
    protocolVersion: '1.0',
    type: 'invoke',
    requestId: 'req-1',
    method: 'collect',
  };
}

function makeResultMessage(): ResultMessage {
  return {
    protocolVersion: '1.0',
    type: 'result',
    requestId: 'req-1',
    data: { ok: true },
  };
}

function makeErrorMessage(): ErrorMessage {
  return {
    protocolVersion: '1.0',
    type: 'error',
    requestId: 'req-1',
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong',
  };
}

// ---------------------------------------------------------------------------
// CollectedCodeData validation
// ---------------------------------------------------------------------------

describe('validateCollectedData', () => {
  it('accepts a minimal valid CollectedCodeData object', () => {
    const data = makeCollectedData();
    expect(validateCollectedData(data)).toBe(true);
  });

  it('rejects data missing the entities field', () => {
    const data = makeCollectedData();
    delete (data as any).entities;

    expect(validateCollectedData(data)).toBe(false);
    const errors = getCollectedDataErrors();
    expect(errors).not.toBeNull();
    expect(errors).toMatch(/entities/);
  });

  it('rejects an entity missing required fields (id)', () => {
    const badEntity = { kind: 'file', name: 'x.ts' } as any;
    const data = makeCollectedData({ entities: [badEntity] });

    expect(validateCollectedData(data)).toBe(false);
    const errors = getCollectedDataErrors();
    expect(errors).not.toBeNull();
  });

  it('rejects a relationship with wrong kind enum value', () => {
    const data = makeCollectedData({
      relationships: [makeRelationship({ kind: 'bad-kind' as any })],
    });

    expect(validateCollectedData(data)).toBe(false);
    const errors = getCollectedDataErrors();
    expect(errors).not.toBeNull();
  });

  it('accepts data with optional signal arrays present', () => {
    const data = makeCollectedData({
      duplicationSignals: [
        {
          source: { tool: 'jscpd', version: '1.0.0' },
          clones: [],
          statistics: {
            totalLines: 100,
            totalTokens: 500,
            totalSources: 5,
            duplicatedLines: 10,
            duplicatedTokens: 50,
          },
        },
      ],
      coverageSignals: [
        {
          source: { tool: 'istanbul', format: 'lcov', version: '3.0.0' },
          files: [
            {
              filePath: 'src/index.ts',
              linesCovered: 80,
              linesTotal: 100,
            },
          ],
        },
      ],
      lintSignals: [
        {
          source: { tool: 'eslint', version: '9.0.0', ruleSet: 'recommended' },
          results: [
            {
              filePath: 'src/index.ts',
              ruleId: 'no-unused-vars',
              severity: 'warning',
              message: 'x is unused',
              line: 5,
              column: 0,
            },
          ],
        },
      ],
    });

    expect(validateCollectedData(data)).toBe(true);
  });

  it('accepts empty entities and relationships arrays', () => {
    const data = makeCollectedData({
      entities: [],
      relationships: [],
    });

    expect(validateCollectedData(data)).toBe(true);
  });

  it('rejects data with a bad sourceRange on an entity (missing endLine)', () => {
    const data = makeCollectedData({
      entities: [
        makeEntity({
          sourceRange: { startLine: 1, startColumn: 0, endColumn: 0 } as any,
        }),
      ],
    });

    expect(validateCollectedData(data)).toBe(false);
  });

  it('rejects data missing schemaVersion', () => {
    const data = makeCollectedData();
    delete (data as any).schemaVersion;

    expect(validateCollectedData(data)).toBe(false);
  });

  it('rejects data with wrong schemaVersion value', () => {
    const data = makeCollectedData({ schemaVersion: '2.0' as any });

    expect(validateCollectedData(data)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProtocolMessage validation
// ---------------------------------------------------------------------------

describe('validateProtocolMessage', () => {
  it('accepts a valid invoke message', () => {
    expect(validateProtocolMessage(makeInvokeMessage())).toBe(true);
  });

  it('accepts a valid result message', () => {
    expect(validateProtocolMessage(makeResultMessage())).toBe(true);
  });

  it('accepts a valid error message', () => {
    expect(validateProtocolMessage(makeErrorMessage())).toBe(true);
  });

  it('accepts a valid progress message', () => {
    const msg: AspectProtocolMessage = {
      protocolVersion: '1.0',
      type: 'progress',
      requestId: 'req-1',
      message: 'Collecting entities…',
    };
    expect(validateProtocolMessage(msg)).toBe(true);
  });

  it('accepts a valid chunk message', () => {
    const msg: AspectProtocolMessage = {
      protocolVersion: '1.0',
      type: 'chunk',
      requestId: 'req-1',
      section: 'entities',
      data: [{ id: 'e1' }],
      index: 0,
      final: true,
    };
    expect(validateProtocolMessage(msg)).toBe(true);
  });

  it('accepts a valid complete message', () => {
    const msg: AspectProtocolMessage = {
      protocolVersion: '1.0',
      type: 'complete',
      requestId: 'req-1',
      success: true,
    };
    expect(validateProtocolMessage(msg)).toBe(true);
  });

  it('rejects a message with an unknown type', () => {
    const msg = {
      protocolVersion: '1.0',
      type: 'unknown-type',
      requestId: 'req-1',
    };

    expect(validateProtocolMessage(msg)).toBe(false);
  });

  it('rejects an invoke message missing required method field', () => {
    const msg = {
      protocolVersion: '1.0',
      type: 'invoke',
      requestId: 'req-1',
      // missing: method
    };

    expect(validateProtocolMessage(msg)).toBe(false);
  });

  it('rejects a message with wrong protocolVersion', () => {
    const msg = {
      protocolVersion: '2.0',
      type: 'invoke',
      requestId: 'req-1',
      method: 'collect',
    };

    expect(validateProtocolMessage(msg)).toBe(false);
  });

  it('rejects a completely empty object', () => {
    expect(validateProtocolMessage({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error message formatting
// ---------------------------------------------------------------------------

describe('getCollectedDataErrors', () => {
  it('returns a readable error string after failed validation', () => {
    // Force a failure first
    validateCollectedData({ bad: true });

    const errors = getCollectedDataErrors();
    expect(errors).not.toBeNull();
    expect(typeof errors).toBe('string');
    expect(errors!.length).toBeGreaterThan(0);
  });

  it('returns null after successful validation', () => {
    validateCollectedData(makeCollectedData());

    expect(getCollectedDataErrors()).toBeNull();
  });
});

describe('getProtocolMessageErrors', () => {
  it('returns a readable error string after failed validation', () => {
    validateProtocolMessage({ bad: true });

    const errors = getProtocolMessageErrors();
    expect(errors).not.toBeNull();
    expect(typeof errors).toBe('string');
    expect(errors!.length).toBeGreaterThan(0);
  });

  it('returns null after successful validation', () => {
    validateProtocolMessage(makeInvokeMessage());

    expect(getProtocolMessageErrors()).toBeNull();
  });
});

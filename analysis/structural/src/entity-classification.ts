/**
 * @aspect/engine — Entity-level code concern classification
 *
 * Classifies each entity (function, class, interface, etc.) into a code concern:
 *   - contract:      Types, interfaces, type-aliases, enums, DTOs
 *   - presentation:  JSX-heavy components, rendering functions
 *   - logic:         Business rules, algorithms, data transformations
 *   - unknown:       Cannot determine from available signals
 *
 * Unlike file-level classification (step 2), this operates per entity using
 * the entity's own kind, name, rawCounts (JSX, branch points), and
 * classification flags (isTypeOnly, isInterface, isAbstract).
 */

import type { Entity } from '@aspect/contracts';

export type EntityConcern = 'contract' | 'presentation' | 'logic' | 'unknown';

export interface EntityConcernResult {
  entityId: string;
  concern: EntityConcern;
  confidence: number;
  signals: string[];
}

export interface EntityClassificationSummary {
  results: EntityConcernResult[];
  totals: Record<EntityConcern, number>;
  totalLoc: Record<EntityConcern, number>;
}

// ── Kind-based classification ───────────────────────────────────────────

const CONTRACT_KINDS = new Set([
  'interface', 'type-alias', 'enum',
]);

const PRESENTATION_KINDS = new Set([
  'selector-rule', 'custom-property', 'keyframes', 'mixin',
]);

const LOGIC_FUNCTION_KINDS = new Set([
  'function', 'method',
]);

// ── Name pattern signals ────────────────────────────────────────────────

const LOGIC_NAME_PATTERNS = [
  /^(get|set|compute|calculate|parse|format|validate|check|is|has|should|can|find|build|create|resolve|convert|transform|normalize|compare|sort|filter|map|reduce|aggregate|process|handle|execute|dispatch|emit|on[A-Z])/,
  /^(use[A-Z])/,   // hooks that compute
];

const PRESENTATION_NAME_PATTERNS = [
  /^render[A-Z]/, /(Node|Panel|View|Page|Screen|Widget|Layout|Dialog|Modal|Drawer|Tooltip|Badge|Button|Card|List|Item|Row|Cell|Header|Footer|Sidebar|Navbar|Tab|Icon|Avatar|Chip|Tag|Label)$/,
];

const CONTRACT_NAME_PATTERNS = [
  /(Props|State|Config|Options|Params|Args|Schema|Dto|Payload|Request|Response|Result|Context|Event|Action|Dispatch|Store)$/,
  /^I[A-Z]/,       // IFoo convention
  /^(Abstract|Base)[A-Z]/,
];

// ── Core classifier ─────────────────────────────────────────────────────

export function classifyEntityConcern(entity: Entity): EntityConcernResult {
  const signals: string[] = [];
  const scores: Record<EntityConcern, number> = {
    contract: 0,
    presentation: 0,
    logic: 0,
    unknown: 0,
  };

  const kind = entity.kind;
  const name = entity.name;
  const classification = entity.classification;
  const rawCounts = entity.rawCounts;

  // ── 1. Kind-based signals (strongest) ──

  if (CONTRACT_KINDS.has(kind)) {
    scores.contract += 0.7;
    signals.push(`kind:${kind} → contract`);
  }

  if (PRESENTATION_KINDS.has(kind)) {
    scores.presentation += 0.7;
    signals.push(`kind:${kind} → presentation`);
  }

  // ── 2. Classification flags ──

  if (classification?.isTypeOnly) {
    scores.contract += 0.6;
    signals.push('isTypeOnly → contract');
  }

  if (classification?.isInterface) {
    scores.contract += 0.5;
    signals.push('isInterface → contract');
  }

  if (classification?.isAbstract) {
    scores.contract += 0.3;
    signals.push('isAbstract → contract');
  }

  // ── 3. JSX content (entity-level) ──

  const jsxCount = rawCounts?.jsxElementCount ?? 0;
  const loc = rawCounts?.linesOfCode ?? 0;

  if (jsxCount > 0 && loc > 0) {
    const jsxDensity = jsxCount / loc;
    if (jsxDensity >= 0.15) {
      scores.presentation += 0.7;
      signals.push(`jsxDensity:${(jsxDensity * 100).toFixed(0)}% → presentation`);
    } else if (jsxCount >= 1) {
      scores.presentation += 0.3;
      signals.push(`jsxCount:${jsxCount} → presentation (partial)`);
    }
  }

  // ── 4. Complexity signals (branch points = logic) ──

  const branchPoints = rawCounts?.branchPoints ?? 0;
  if (branchPoints > 0 && LOGIC_FUNCTION_KINDS.has(kind)) {
    if (branchPoints >= 5) {
      scores.logic += 0.5;
      signals.push(`branchPoints:${branchPoints} → logic (complex)`);
    } else if (branchPoints >= 2) {
      scores.logic += 0.3;
      signals.push(`branchPoints:${branchPoints} → logic`);
    }
  }

  // ── 5. Name pattern signals ──

  if (LOGIC_NAME_PATTERNS.some((p) => p.test(name))) {
    scores.logic += 0.3;
    signals.push(`name:${name} → logic pattern`);
  }

  if (PRESENTATION_NAME_PATTERNS.some((p) => p.test(name))) {
    scores.presentation += 0.3;
    signals.push(`name:${name} → presentation pattern`);
  }

  if (CONTRACT_NAME_PATTERNS.some((p) => p.test(name))) {
    scores.contract += 0.3;
    signals.push(`name:${name} → contract pattern`);
  }

  // ── 6. Function-like entities default to logic ──

  if (LOGIC_FUNCTION_KINDS.has(kind) && classification?.isConcrete) {
    scores.logic += 0.15;
    signals.push(`concrete ${kind} → logic baseline`);
  }

  // ── Resolve ──

  const entries = Object.entries(scores) as Array<[EntityConcern, number]>;
  entries.sort((a, b) => b[1] - a[1]);

  const [bestConcern, bestScore] = entries[0];
  const [, secondScore] = entries[1];

  if (bestScore < 0.15) {
    return { entityId: entity.id, concern: 'unknown', confidence: 0, signals };
  }

  const confidence = Math.min(1, Math.max(0, bestScore - secondScore));
  return { entityId: entity.id, concern: bestConcern, confidence, signals };
}

// ── Batch classifier ────────────────────────────────────────────────────

export function classifyAllEntities(entities: Entity[]): EntityClassificationSummary {
  const results: EntityConcernResult[] = [];
  const totals: Record<EntityConcern, number> = { contract: 0, presentation: 0, logic: 0, unknown: 0 };
  const totalLoc: Record<EntityConcern, number> = { contract: 0, presentation: 0, logic: 0, unknown: 0 };

  for (const entity of entities) {
    if (entity.kind === 'file') continue; // file entities classified separately
    const result = classifyEntityConcern(entity);
    results.push(result);
    totals[result.concern]++;
    totalLoc[result.concern] += entity.rawCounts?.linesOfCode ?? 0;
  }

  return { results, totals, totalLoc };
}

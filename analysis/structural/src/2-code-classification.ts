/**
 * @aspect/engine — Step 2: Code content classification
 *
 * Runs ONLY on files that step 1 classified as 'code'. Determines
 * the structural role of each code file:
 *
 *   - contract:        Types, interfaces, DTOs, schemas — boundary definitions
 *   - logic:           Business rules, domain logic, services
 *   - presentation:    UI components, rendering, views
 *   - infrastructure:  Utilities, helpers, shared plumbing, adapters
 *   - entry_point:     Index/barrel files, main entry, CLI entry
 *   - unknown:         Cannot determine from available signals
 *
 * Language-specific knowledge (entity kind mapping, JSX handling,
 * declaration files) is injected via LanguageProfile. Without a
 * profile, falls back to broad built-in defaults.
 */

import type { LanguageProfile } from './language-profile.js';

// ── Public types ────────────────────────────────────────────────────────

export type CodeContentRole =
  | 'contract'
  | 'logic'
  | 'presentation'
  | 'infrastructure'
  | 'entry_point'
  | 'barrel'
  | 'unknown';

export interface ClassifiableEntity {
  kind: string;
  name: string;
  isExported: boolean;
  jsxElementCount?: number;
  linesOfCode?: number;
}

export interface FileCouplingInfo {
  fanIn: number;
  fanOut: number;
  incomingTotal: number;
  incomingTypeOnly: number;
  incomingValue: number;
  typeOnlyInRatio: number;
  outgoingTotal: number;
  outgoingTypeOnly: number;
  outgoingValue: number;
  typeOnlyOutRatio: number;
}

export interface ContentClassification {
  role: CodeContentRole;
  confidence: number;
  composition: Partial<Record<CodeContentRole, number>>;
  signals: ContentSignal[];
  scores?: Record<CodeContentRole, number>;
}

export interface ContentSignal {
  signal: string;
  role: CodeContentRole;
  weight: number;
  description: string;
}

// ── Built-in entity kind defaults (backwards compatibility) ─────────────

const BUILTIN_CONTRACT_KINDS = new Set(['interface', 'type-alias', 'enum']);
const BUILTIN_LOGIC_KINDS = new Set(['class', 'function', 'method']);
const BUILTIN_PROPERTY_KINDS = new Set(['field', 'property']);

// ── Universal path patterns (not language-specific) ─────────────────────

const INFRA_PATH_PATTERNS = [
  /\butil(s|itie?s)?\b/i, /\bhelper(s)?\b/i, /\bcommon\b/i,
  /\bshared\b/i, /\blib\b/i, /\badapter(s)?\b/i,
  /\binfra(structure)?\b/i, /\bmiddleware\b/i,
  /\bplugin(s)?\b/i, /\bextension(s)?\b/i,
  /\bstorage\b/i, /\bpersistence\b/i,
  /\bfs\b/, /\bfilesystem\b/i, /\bio\b/,
  /\blogger\b/i, /\blog(ging)?\b/i, /\bcache\b/i,
  /\bconfig(uration)?\b/i, /\bdb\b/i, /\bdatabase\b/i,
];

const CONTRACT_PATH_PATTERNS = [
  /\btypes?\b/i, /\binterfaces?\b/i, /\bcontract(s)?\b/i,
  /\bdto(s)?\b/i, /\bschema(s)?\b/i, /\bmodel(s)?\b/i,
];

const PRESENTATION_PATH_PATTERNS = [
  /\bcomponent(s)?\b/i, /\bview(s)?\b/i, /\bpage(s)?\b/i,
  /\bscreen(s)?\b/i, /\bui\b/i, /\bwidget(s)?\b/i,
  /\blayout(s)?\b/i, /\btemplate(s)?\b/i, /\brender\b/i,
  /\bpanel(s)?\b/i,
];

const LOGIC_PATH_PATTERNS = [
  /\bcommand(s)?\b/i, /\bhandler(s)?\b/i, /\bservice(s)?\b/i,
  /\borchestrat(or|ion|e)(s)?\b/i, /\bcontroller(s)?\b/i,
  /\btool(s)?\b/i, /\broute(s|r)?\b/i, /\baction(s)?\b/i,
  /\bworkflow(s)?\b/i, /\bpipeline(s)?\b/i, /\buse[A-Z]/,
];

const BARREL_PATTERNS = [
  /\/index\.[^.]+$/,
];

const ENTRY_POINT_PATTERNS = [
  /\/main\.[^.]+$/, /\/app\.[^.]+$/,
  /\/cli\.[^.]+$/, /\/entry\.[^.]+$/, /\/mod\.[^.]+$/,
  /\/init\.[^.]+$/, /\/bootstrap\.[^.]+$/, /\/start\.[^.]+$/,
  /\/server\.[^.]+$/, /\/register\.[^.]+$/,
];

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizePath(p: string): string { return p.replace(/\\/g, '/'); }
function matchesAny(text: string, patterns: RegExp[]): boolean { return patterns.some((p) => p.test(text)); }
function round2(n: number): number { return Math.round(n * 100) / 100; }

// ── Composition calculator ──────────────────────────────────────────────

/**
 * Compute entity composition (contract / logic / presentation ratio).
 *
 * Base computation uses entity kinds to classify. The optional profile
 * provides language-specific entity kind mapping and composition adjustments
 * (e.g. JSX element splitting for React).
 */
export function computeComposition(
  entities: ClassifiableEntity[],
  fileExtension: string,
  profile?: LanguageProfile,
): Partial<Record<CodeContentRole, number>> {
  if (entities.length === 0) return {};

  // Use profile entity kinds or built-in defaults
  const contractKinds = profile?.contractEntityKinds ?? BUILTIN_CONTRACT_KINDS;
  const logicKinds = profile?.logicEntityKinds ?? BUILTIN_LOGIC_KINDS;
  const propertyKinds = profile?.propertyEntityKinds ?? BUILTIN_PROPERTY_KINDS;

  let contractWeight = 0;
  let logicWeight = 0;
  let presentationWeight = 0;

  for (const e of entities) {
    if (contractKinds.has(e.kind)) {
      contractWeight += 1;
    } else if (logicKinds.has(e.kind) || propertyKinds.has(e.kind)) {
      logicWeight += 1;
    }
  }

  const total = contractWeight + logicWeight + presentationWeight;
  if (total === 0) return {};

  let result: Partial<Record<CodeContentRole, number>> = {};
  if (contractWeight > 0) result.contract = round2(contractWeight / total);
  if (logicWeight > 0) result.logic = round2(logicWeight / total);
  if (presentationWeight > 0) result.presentation = round2(presentationWeight / total);

  // Apply language-specific composition adjustments via profile
  if (profile?.adjustComposition) {
    result = profile.adjustComposition(result, fileExtension, entities);
  }

  return result;
}

// ── Signal collectors ───────────────────────────────────────────────────

function collectPathSignals(filePath: string): ContentSignal[] {
  const norm = normalizePath(filePath);
  const signals: ContentSignal[] = [];

  if (matchesAny(norm, INFRA_PATH_PATTERNS)) {
    signals.push({ signal: 'infra-path', role: 'infrastructure', weight: 0.35,
      description: 'Path matches infrastructure pattern (util/helper/common/shared/lib/adapter)' });
  }
  if (matchesAny(norm, CONTRACT_PATH_PATTERNS)) {
    signals.push({ signal: 'contract-path', role: 'contract', weight: 0.35,
      description: 'Path matches contract pattern (types/interfaces/contracts/dto/schema/models)' });
  }
  if (matchesAny(norm, PRESENTATION_PATH_PATTERNS)) {
    signals.push({ signal: 'presentation-path', role: 'presentation', weight: 0.40,
      description: 'Path matches presentation pattern (components/views/pages/screens/ui)' });
  }
  if (matchesAny(norm, BARREL_PATTERNS)) {
    signals.push({ signal: 'barrel-path', role: 'barrel', weight: 0.35,
      description: 'File is an index/barrel file (re-exports submodules)' });
  }
  if (matchesAny(norm, ENTRY_POINT_PATTERNS)) {
    signals.push({ signal: 'entry-point-path', role: 'entry_point', weight: 0.30,
      description: 'File is an entry point (main/app/cli/server)' });
  }
  if (matchesAny(norm, LOGIC_PATH_PATTERNS)) {
    signals.push({ signal: 'logic-path', role: 'logic', weight: 0.35,
      description: 'Path matches logic pattern (commands/handlers/services/tools/routes/workflows)' });
  }

  // Filename-based semantic signals (stem without extension)
  const filename = norm.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  if (/^file[-_]|[-_](ops|read|write|io|stream|buffer|parse|format|patch|search)$/.test(filename)) {
    signals.push({ signal: 'infra-filename', role: 'infrastructure', weight: 0.30,
      description: `Filename "${filename}" suggests infrastructure/utility` });
  }

  return signals;
}

function collectExtensionSignals(filePath: string, ext: string, profile?: LanguageProfile): ContentSignal[] {
  if (profile?.collectExtensionSignals) {
    return profile.collectExtensionSignals(filePath, ext);
  }
  return [];
}

function collectEntitySignals(
  entities: ClassifiableEntity[],
  composition: Partial<Record<CodeContentRole, number>>,
  profile?: LanguageProfile,
): ContentSignal[] {
  const signals: ContentSignal[] = [];

  // No own declarations = strong barrel signal (pure re-export file)
  if (entities.length === 0) {
    signals.push({ signal: 'no-own-entities', role: 'barrel', weight: 0.40,
      description: 'File has no own declarations — pure re-export barrel' });
    return signals;
  }

  const contractPct = composition.contract ?? 0;
  const presentationPct = composition.presentation ?? 0;

  if (contractPct >= 0.8) {
    signals.push({ signal: 'pure-type-file', role: 'contract', weight: 0.55,
      description: `${Math.round(contractPct * 100)}% of entities are types/interfaces — pure contract file` });
  } else if (contractPct >= 0.5) {
    signals.push({ signal: 'majority-types', role: 'contract', weight: 0.40,
      description: `${Math.round(contractPct * 100)}% of entities are types/interfaces` });
  }

  if (presentationPct >= 0.4) {
    signals.push({ signal: 'significant-jsx', role: 'presentation', weight: 0.35,
      description: `${Math.round(presentationPct * 100)}% of content is JSX rendering` });
  }

  const logicKinds = profile?.logicEntityKinds ?? BUILTIN_LOGIC_KINDS;
  const classCount = entities.filter((e) => e.kind === 'class').length;
  const methodCount = entities.filter((e) => e.kind === 'method').length;
  if (classCount > 0 && methodCount >= 3) {
    signals.push({ signal: 'class-with-methods', role: 'logic', weight: 0.30,
      description: `Contains ${classCount} class(es) with ${methodCount} methods` });
  }

  const contractKinds = profile?.contractEntityKinds ?? BUILTIN_CONTRACT_KINDS;
  const exportedCount = entities.filter((e) => e.isExported).length;
  if (exportedCount === entities.length && entities.length >= 3) {
    const allSimple = entities.every(
      (e) => contractKinds.has(e.kind) || logicKinds.has(e.kind) || e.kind === 'variable',
    );
    if (allSimple) {
      signals.push({ signal: 'all-exported', role: 'barrel', weight: 0.15,
        description: 'All entities are exported — potential barrel/re-export file' });
    }
  }

  return signals;
}

export function collectCouplingSignals(coupling: FileCouplingInfo | undefined): ContentSignal[] {
  const signals: ContentSignal[] = [];
  if (!coupling) return signals;

  if (coupling.fanIn >= 5 && coupling.fanOut <= 3) {
    signals.push({ signal: 'high-fan-in-low-fan-out', role: 'infrastructure', weight: 0.45,
      description: `Fan-in ${coupling.fanIn} (high), fan-out ${coupling.fanOut} (low) — widely reused` });
  }
  if (coupling.fanIn >= 2 && coupling.fanOut >= 2) {
    signals.push({ signal: 'moderate-coupling', role: 'logic', weight: 0.20,
      description: `Moderate fan-in (${coupling.fanIn}) and fan-out (${coupling.fanOut})` });
  }
  if (coupling.fanOut >= 5 && coupling.fanIn <= 1) {
    signals.push({ signal: 'high-fan-out-low-fan-in', role: 'entry_point', weight: 0.25,
      description: `Fan-out ${coupling.fanOut} (high), fan-in ${coupling.fanIn} (low) — orchestrator/entry` });
  }

  if (coupling.incomingTotal > 0) {
    if (coupling.typeOnlyInRatio >= 0.7) {
      signals.push({ signal: 'imported-as-types', role: 'contract', weight: 0.45,
        description: `${Math.round(coupling.typeOnlyInRatio * 100)}% of consumers use type-only imports — this file defines contracts` });
    } else if (coupling.typeOnlyInRatio <= 0.2 && coupling.incomingTotal >= 3) {
      signals.push({ signal: 'imported-as-values', role: 'logic', weight: 0.15,
        description: `${Math.round((1 - coupling.typeOnlyInRatio) * 100)}% of consumers use value imports — this file provides runtime behavior` });
    }
  }

  if (coupling.outgoingTotal > 0) {
    if (coupling.typeOnlyOutRatio >= 0.7) {
      signals.push({ signal: 'imports-mostly-types', role: 'logic', weight: 0.10,
        description: `${Math.round(coupling.typeOnlyOutRatio * 100)}% of outgoing imports are type-only — depends on contracts, not implementations` });
    } else if (coupling.typeOnlyOutRatio <= 0.2 && coupling.outgoingTotal >= 3) {
      signals.push({ signal: 'imports-mostly-values', role: 'logic', weight: 0.10,
        description: `${Math.round((1 - coupling.typeOnlyOutRatio) * 100)}% of outgoing imports are value imports — depends on implementations` });
    }
    if (coupling.typeOnlyInRatio >= 0.7 && coupling.outgoingValue >= 2) {
      signals.push({ signal: 'contract-imports-values', role: 'logic', weight: 0.15,
        description: `Imported as types but has ${coupling.outgoingValue} value imports — contract file with implementation dependencies` });
    }
  }

  return signals;
}

// ── Score aggregation ───────────────────────────────────────────────────

const ALL_ROLES: CodeContentRole[] = ['contract', 'logic', 'presentation', 'infrastructure', 'entry_point', 'barrel'];
const MIN_SCORE = 0.25;

function aggregateScores(signals: ContentSignal[]): {
  role: CodeContentRole;
  confidence: number;
  scores: Record<CodeContentRole, number>;
} {
  const scores: Record<CodeContentRole, number> = {
    contract: 0, logic: 0, presentation: 0,
    infrastructure: 0, entry_point: 0, barrel: 0, unknown: 0,
  };

  for (const s of signals) scores[s.role] += s.weight;
  scores.logic += 0.10;

  const sorted = ALL_ROLES
    .map((r) => ({ role: r, score: scores[r] }))
    .sort((a, b) => b.score - a.score);

  const best = sorted[0];
  const second = sorted[1];

  if (best.score < MIN_SCORE) {
    return { role: 'unknown', confidence: 0, scores };
  }

  const confidence = Math.min(1, Math.max(0, best.score - second.score));
  return { role: best.role, confidence, scores };
}

// ── Main entry point ────────────────────────────────────────────────────

export interface ClassifyContentInput {
  filePath: string;
  fileExtension: string;
  entities: ClassifiableEntity[];
  coupling?: FileCouplingInfo;
  /** Optional language profile for this file */
  profile?: LanguageProfile;
}

export function classifyCodeContent(input: ClassifyContentInput): ContentClassification {
  const profile = input.profile;
  const composition = computeComposition(input.entities, input.fileExtension, profile);

  const pathSignals = collectPathSignals(input.filePath);
  const extSignals = collectExtensionSignals(input.filePath, input.fileExtension, profile);
  const entitySignals = collectEntitySignals(input.entities, composition, profile);
  const couplingSignals = collectCouplingSignals(input.coupling);

  const allSignals = [...pathSignals, ...extSignals, ...entitySignals, ...couplingSignals];

  // Index files with very few own entities but high fan-out are barrels
  // that also export a convenience factory or similar.
  // Suppress competing path-based role signals (the directory name, not the file,
  // causes logic/infra/contract path matches — misleading for barrels).
  const isIndex = matchesAny(normalizePath(input.filePath), BARREL_PATTERNS);
  if (isIndex && input.entities.length <= 2 && input.coupling && input.coupling.fanOut >= 3) {
    allSignals.push({
      signal: 'barrel-few-entities-high-fanout',
      role: 'barrel',
      weight: 0.45,
      description: `Index file with only ${input.entities.length} own entit${input.entities.length === 1 ? 'y' : 'ies'} but fan-out ${input.coupling.fanOut} — barrel with convenience export`,
    });
    // Dampen path-based signals from parent directory names
    for (const s of allSignals) {
      if (s.role !== 'barrel' && s.signal.endsWith('-path')) {
        s.weight *= 0.3;
      }
    }
  }

  const { role, confidence, scores } = aggregateScores(allSignals);

  const finalComposition = Object.keys(composition).length > 0
    ? composition
    : { [role]: 1 };

  return { role, confidence, composition: finalComposition, signals: allSignals, scores };
}

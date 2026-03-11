import type { AccessRule, Effect, Right } from './rights.js';
import { ALL_RIGHTS } from './rights.js';
import path from 'node:path';

export interface AccessPatternSet {
  read: string[];
  write: string[];
  create: string[];
  delete: string[];
}

interface SectionSpec {
  title: string;
  effect: Effect;
  rights: Right[];
}

const COMMENT_PREFIXES = ['#', ';'];
const ACCESS_SECTION_HEADER_RE = /^\s*\[([^\]]+)\]\s*$/;

function isCommentOrEmpty(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return COMMENT_PREFIXES.some((p) => trimmed.startsWith(p));
}

/** Parse ignore-style file content into raw patterns. */
export function parseIgnoreStylePatterns(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const patterns: string[] = [];

  for (const line of lines) {
    if (isCommentOrEmpty(line)) continue;
    patterns.push(line.trim());
  }

  return patterns;
}

/**
 * Scope a glob pattern from a base workspace-relative directory.
 *
 * Example:
 * - baseDir: `packages/web`
 * - pattern: `dist/**`
 * - result: `packages/web/dist/**`
 */
export function scopePatternToBaseDir(pattern: string, baseDir: string): string {
  const raw = pattern.replaceAll('\\', '/').trim();
  if (!raw) return raw;

  const normalizedBase = trimOuterSlashes(baseDir.replaceAll('\\', '/'));
  const normalizedPattern = raw.startsWith('/') ? raw.slice(1) : raw;

  if (!normalizedBase) {
    return path.posix.normalize(normalizedPattern);
  }

  return path.posix.normalize(`${normalizedBase}/${normalizedPattern}`);
}

function trimOuterSlashes(value: string): string {
  let result = value;
  while (result.startsWith('/')) {
    result = result.slice(1);
  }
  while (result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
}

function parseAccessFileWithoutSections(lines: string[]): AccessRule[] {
  const rules: AccessRule[] = [];
  for (const line of lines) {
    if (isCommentOrEmpty(line)) continue;
    const trimmed = line.trim();
    const isDeny = trimmed.startsWith('!');
    const pattern = isDeny ? trimmed.slice(1).trim() : trimmed;
    if (!pattern) continue;

    for (const right of ALL_RIGHTS) {
      rules.push({
        right,
        effect: isDeny ? 'deny' : 'allow',
        pathPattern: pattern,
        label: isDeny
          ? 'access-file fallback deny-all (!pattern)'
          : 'access-file fallback allow-all',
      });
    }
  }
  return rules;
}

function parseAccessFileWithSections(lines: string[]): AccessRule[] {
  const rules: AccessRule[] = [];
  let currentSection: SectionSpec | null = null;

  for (const line of lines) {
    if (isCommentOrEmpty(line)) continue;

    const headerMatch = ACCESS_SECTION_HEADER_RE.exec(line);
    if (headerMatch) {
      currentSection = parseSectionHeader(headerMatch[1]);
      continue;
    }

    if (!currentSection) {
      throw new Error(
        `Access-file contains pattern '${line.trim()}' outside of a section. `
        + 'When using sections, put every pattern under a [section title].',
      );
    }

    const pattern = line.trim();
    for (const right of currentSection.rights) {
      rules.push({
        right,
        effect: currentSection.effect,
        pathPattern: pattern,
        label: `access-file section: ${currentSection.title}`,
      });
    }
  }

  return rules;
}

function parseSectionHeader(rawTitle: string): SectionSpec {
  const title = rawTitle.trim();
  const normalized = title.toLowerCase();

  let effect: Effect = 'allow';
  let rightsSpec = normalized;

  if (rightsSpec.startsWith('allow ')) {
    rightsSpec = rightsSpec.slice('allow '.length).trim();
  } else if (rightsSpec.startsWith('deny ')) {
    effect = 'deny';
    rightsSpec = rightsSpec.slice('deny '.length).trim();
  }

  if (rightsSpec === 'all' || rightsSpec === '*') {
    return { title, effect, rights: [...ALL_RIGHTS] };
  }

  const tokens = rightsSpec
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const rights: Right[] = [];
  for (const token of tokens) {
    if (token === 'read' || token === 'write' || token === 'create' || token === 'delete' || token === 'list') {
      rights.push(token);
      continue;
    }

    if (token === 'all' || token === '*') {
      rights.push(...ALL_RIGHTS);
      continue;
    }

    throw new Error(
      `Invalid access-file section title '${title}'. Use rights like [write], [read,write], [deny delete], or [all].`,
    );
  }

  const deduped = [...new Set(rights)];
  if (deduped.length === 0) {
    throw new Error(
      `Invalid access-file section title '${title}'. At least one right is required.`,
    );
  }

  return { title, effect, rights: deduped };
}

/**
 * Parse an ignore-style access file into AccessRule entries.
 *
 * File modes:
 * 1) No section headers: every pattern becomes allow-all-rights,
 *    and `!pattern` becomes deny-all-rights.
 *    This creates an allow-list style file over the default implicit-deny baseline.
 * 2) Section headers present: each pattern line under a section becomes
 *    a rule using that section's effect/rights.
 *
 * Section syntax examples:
 * - [write]
 * - [read,write]
 * - [deny delete]
 * - [all]
 */
export function parseAccessFile(content: string): AccessRule[] {
  const lines = content.split(/\r?\n/);
  const hasSections = lines.some((line) => ACCESS_SECTION_HEADER_RE.test(line));
  return hasSections
    ? parseAccessFileWithSections(lines)
    : parseAccessFileWithoutSections(lines);
}

function normalizePatterns(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Convert parsed access rules into allow-only path pattern lists used by AI Team permissions.
 * Deny rules and the `list` right are ignored for this projection.
 */
export function accessRulesToPatternSet(rules: readonly AccessRule[]): AccessPatternSet {
  const read: string[] = [];
  const write: string[] = [];
  const create: string[] = [];
  const del: string[] = [];

  for (const rule of rules) {
    if (rule.effect !== 'allow') {
      continue;
    }

    if (rule.right === 'read') {
      read.push(rule.pathPattern);
      continue;
    }

    if (rule.right === 'write') {
      write.push(rule.pathPattern);
      continue;
    }

    if (rule.right === 'create') {
      create.push(rule.pathPattern);
      continue;
    }

    if (rule.right === 'delete') {
      del.push(rule.pathPattern);
    }
  }

  return {
    read: normalizePatterns(read),
    write: normalizePatterns(write),
    create: normalizePatterns(create),
    delete: normalizePatterns(del),
  };
}

/**
 * Serialize allow-only AI Team permission patterns into deterministic sectioned .access format.
 */
export function serializePatternSetToAccessFile(patterns: AccessPatternSet): string {
  const normalized: AccessPatternSet = {
    read: normalizePatterns(patterns.read),
    write: normalizePatterns(patterns.write),
    create: normalizePatterns(patterns.create),
    delete: normalizePatterns(patterns.delete),
  };

  const sections: Array<[Right, string[]]> = [
    ['read', normalized.read],
    ['write', normalized.write],
    ['create', normalized.create],
    ['delete', normalized.delete],
  ];

  const nonEmpty = sections.filter(([, values]) => values.length > 0);
  if (nonEmpty.length === 0) {
    return '';
  }

  const lines: string[] = [
    '# Managed by AI Team. Edit with care.',
    '# Section names map to permission modes: [read], [write], [create], [delete].',
  ];

  for (const [index, [right, values]] of nonEmpty.entries()) {
    lines.push('', `[${right}]`, ...values);
    if (index < nonEmpty.length - 1) {
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

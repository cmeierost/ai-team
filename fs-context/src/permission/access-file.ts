import type { PermissionRule, Effect, Right } from './types.js';
import { ALL_RIGHTS } from './types.js';
import { matchesPattern } from './glob-engine.js';
import path from 'node:path';

export interface AccessPatternSet {
  list: string[];
  read: string[];
  write: string[];
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

function parseAccessFileWithoutSections(lines: string[]): PermissionRule[] {
  const rules: PermissionRule[] = [];
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

function parseAccessFileWithSections(lines: string[]): PermissionRule[] {
  const rules: PermissionRule[] = [];
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
        `Access-file contains pattern '${line.trim()}' outside of a section. ` +
          'When using sections, put every pattern under a [section title].'
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

      // Keep AI Team compatibility: read access implies list access.
      if (right === 'read') {
        rules.push({
          right: 'list',
          effect: currentSection.effect,
          pathPattern: pattern,
          label: `access-file section: ${currentSection.title} (read=>list)`,
        });
      }
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
    // Legacy: create/delete map to write
    if (token === 'create' || token === 'delete') {
      rights.push('write');
      continue;
    }

    if (token === 'read' || token === 'write' || token === 'list') {
      rights.push(token);
      continue;
    }

    if (token === 'all' || token === '*') {
      rights.push(...ALL_RIGHTS);
      continue;
    }

    throw new Error(
      `Invalid access-file section title '${title}'. Use rights like [write], [read,write], [deny delete], or [all].`
    );
  }

  const deduped = [...new Set(rights)];
  if (deduped.length === 0) {
    throw new Error(
      `Invalid access-file section title '${title}'. At least one right is required.`
    );
  }

  return { title, effect, rights: deduped };
}

/**
 * Parse an ignore-style access file into PermissionRule entries.
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
export function parseAccessFile(content: string): PermissionRule[] {
  const lines = content.split(/\r?\n/);
  const hasSections = lines.some((line) => ACCESS_SECTION_HEADER_RE.test(line));
  return hasSections ? parseAccessFileWithSections(lines) : parseAccessFileWithoutSections(lines);
}

function normalizePatterns(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

/**
 * Check whether a workspace-relative path is readable under a given pattern set.
 * Read patterns grant read access; write patterns also imply read access.
 */
export function canRead(relativePath: string, patterns: AccessPatternSet): boolean {
  return (
    patterns.read.some((p) => matchesPattern(relativePath, p)) ||
    patterns.write.some((p) => matchesPattern(relativePath, p))
  );
}

/**
 * Check whether a workspace-relative path is writable under a given pattern set.
 */
export function canWrite(relativePath: string, patterns: AccessPatternSet): boolean {
  return patterns.write.some((p) => matchesPattern(relativePath, p));
}

/**
 * Check whether a workspace-relative path is listable under a given pattern set.
 * Default-open: if no explicit list patterns are defined, all listing is allowed.
 */
export function canList(relativePath: string, patterns: AccessPatternSet): boolean {
  if (patterns.list.length === 0) return true;
  return patterns.list.some((p) => matchesPattern(relativePath, p));
}

/**
 * Extract only the *explicitly* specified list patterns from parsed rules.
 * Rules derived from read access (labeled `(read=>list)`) are excluded.
 *
 * Use this when you need to distinguish "no list restriction defined" (default-open)
 * from "Agent has read access, therefore implicit list access".
 */
export function explicitListPatternsFromRules(rules: readonly PermissionRule[]): string[] {
  const list: string[] = [];
  for (const rule of rules) {
    if (rule.effect !== 'allow') continue;
    if (rule.right === 'list' && !rule.label?.endsWith('(read=>list)')) {
      list.push(rule.pathPattern);
    }
  }
  return normalizePatterns(list);
}

/**
 * Convert parsed access rules into allow-only path pattern lists used by AI Team permissions.
 * Deny rules and the `list` right are ignored for this projection.
 */
export function permissionRulesToPatternSet(rules: readonly PermissionRule[]): AccessPatternSet {
  const read: string[] = [];
  const write: string[] = [];
  const list: string[] = [];

  for (const rule of rules) {
    if (rule.effect !== 'allow') {
      continue;
    }

    if (rule.right === 'read') {
      read.push(rule.pathPattern);
    } else if (rule.right === 'write') {
      write.push(rule.pathPattern);
    } else if (rule.right === 'list') {
      list.push(rule.pathPattern);
    }
  }

  return {
    read: normalizePatterns(read),
    write: normalizePatterns(write),
    list: normalizePatterns(list),
  };
}

/**
 * Serialize allow-only AI Team permission patterns into deterministic sectioned .perm format.
 */
export function serializePatternSetToAccessFile(patterns: AccessPatternSet): string {
  const normalized: AccessPatternSet = {
    list: normalizePatterns(patterns.list), // list patterns are not represented in the output file since they are implied by read patterns
    read: normalizePatterns(patterns.read),
    write: normalizePatterns(patterns.write),
  };

  const sections: Array<[Right, string[]]> = [
    ['read', normalized.read],
    ['write', normalized.write],
  ];

  const nonEmpty = sections.filter(([, values]) => values.length > 0);
  if (nonEmpty.length === 0) {
    return '';
  }

  const lines: string[] = [
    '# Managed by AI Team. Edit with care.',
    '# Section names map to permission modes: [read], [write].',
  ];

  for (const [index, [right, values]] of nonEmpty.entries()) {
    lines.push('', `[${right}]`, ...values);
    if (index < nonEmpty.length - 1) {
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

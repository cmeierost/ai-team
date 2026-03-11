import type { AccessRule, Effect, Right } from './rights.js';
import { ALL_RIGHTS } from './rights.js';
import path from 'node:path';

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
    const pattern = line.trim();
    for (const right of ALL_RIGHTS) {
      rules.push({
        right,
        effect: 'deny',
        pathPattern: pattern,
        label: 'access-file fallback deny-all',
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
 * 1) No section headers: every pattern becomes deny-all-rights
 *    (gitignore/.copilot-ignore compatible fallback).
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

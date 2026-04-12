import { parse as parseYaml } from 'yaml';
import type { ParsedPermFile, PatternToken, PermFileMeta, Right, SectionMap } from './types.js';
import { scopePatternToBaseDir } from './access-file.js';

const COMMENT_PREFIXES = ['#', ';'];
const SECTION_HEADER_RE = /^\s*\[([^\]]+)\]\s*$/;
const VALID_SECTIONS = new Set<string>(['list', 'read', 'write']);

function isCommentOrEmpty(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return COMMENT_PREFIXES.some((p) => trimmed.startsWith(p));
}

function tokenizeLine(raw: string): PatternToken {
  const trimmed = raw.trim();
  if (trimmed === '*') {
    return { raw: trimmed, kind: 'inherit' };
  }
  if (trimmed.startsWith('+')) {
    const pat = trimmed.slice(1).trim();
    return { raw: trimmed, kind: 'allow', pattern: pat, bypass: true };
  }
  if (trimmed.startsWith('!')) {
    const pat = trimmed.slice(1).trim();
    return { raw: trimmed, kind: 'deny', pattern: pat };
  }
  return { raw: trimmed, kind: 'allow', pattern: trimmed };
}

function stripFrontmatter(content: string): { meta: PermFileMeta; body: string } {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { meta: {}, body: content };
  }
  const endIdx = lines.indexOf('---', 1);
  if (endIdx === -1) {
    return { meta: {}, body: content };
  }
  const yamlBlock = lines.slice(1, endIdx).join('\n');
  const parsed = parseYaml(yamlBlock) ?? {};
  const meta: PermFileMeta = {
    id: parsed.id,
    name: parsed.name,
    description: parsed.description,
  };
  const body = lines.slice(endIdx + 1).join('\n');
  return { meta, body };
}

export function parsePermFile(content: string, baseDir: string): ParsedPermFile {
  const { meta, body } = stripFrontmatter(content);
  const lines = body.split(/\r?\n/);

  const sections: SectionMap = { list: [], read: [], write: [] };
  let currentSection: Right | null = null;
  let hasSectionHeaders = false;
  let inUnknownSection = false;

  for (const line of lines) {
    if (isCommentOrEmpty(line)) continue;
    const trimmed = line.trim();

    const headerMatch = SECTION_HEADER_RE.exec(trimmed);
    if (headerMatch) {
      const sectionName = headerMatch[1].trim().toLowerCase();
      if (!VALID_SECTIONS.has(sectionName)) {
        inUnknownSection = true;
        continue;
      }
      currentSection = sectionName as Right;
      inUnknownSection = false;
      hasSectionHeaders = true;
      continue;
    }

    if (inUnknownSection) continue;

    const section: Right = currentSection ?? 'list';
    const token = tokenizeLine(trimmed);

    if (token.kind !== 'inherit' && token.pattern) {
      token.pattern = scopePatternToBaseDir(token.pattern, baseDir);
    }

    sections[section].push(token);
  }

  return { meta, sections, baseDir };
}

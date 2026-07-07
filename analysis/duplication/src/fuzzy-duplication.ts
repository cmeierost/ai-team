import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface FuzzyDuplicateOptions {
  rootDir?: string;
  includeExtensions?: string[];
  excludePatterns?: string[];
  minMatchLength?: number;
  fuzz?: number;
  gapTolerance?: number;
  maxGapBridges?: number;
  maxHoleSize?: number;
  processSameFile?: boolean;
  maxFileBytes?: number;
}

export interface FuzzyDuplicateMatch {
  sourceStartLine: number;
  sourceEndLine: number;
  targetFile: string;
  targetStartLine: number;
  targetEndLine: number;
  matchingLines: number;
  gapCount: number;
  holeCount: number;
}

export interface FuzzyDuplicateFileResult {
  path: string;
  totalLines: number;
  duplicateLines: number;
  duplicatePercent: number;
  matches: FuzzyDuplicateMatch[];
}

export interface FuzzyDuplicateSummary {
  totalDuplicateLines: number;
  totalFiles: number;
  comparedPairs: number;
  matchBlocks: number;
}

export interface FuzzyDuplicateReport {
  files: FuzzyDuplicateFileResult[];
  summary: FuzzyDuplicateSummary;
  options: Required<Omit<FuzzyDuplicateOptions, 'rootDir'>> & { rootDir: string };
}

interface IndexedLine {
  norm: string;
  simhash: bigint;
  bands: number[];
}

interface LoadedFile {
  absolutePath: string;
  relativePath: string;
  lines: string[];
  indexedLines: IndexedLine[];
}

interface BlockMatch {
  startI: number;
  endI: number;
  startJ: number;
  endJ: number;
  matchingLines: number;
  gapCount: number;
  holeCount: number;
}

interface GapBridgeInput {
  fileA: IndexedLine[];
  fileB: IndexedLine[];
  i: number;
  j: number;
  gapTolerance: number;
  fuzz: number;
  gapBridges: number;
  maxGapBridges: number;
  gapCount: number;
}

const DEFAULT_OPTIONS: Required<Omit<FuzzyDuplicateOptions, 'rootDir'>> = {
  includeExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
  excludePatterns: ['node_modules', 'dist', 'build', '.git', 'coverage'],
  minMatchLength: 6,
  fuzz: 2,
  gapTolerance: 1,
  maxGapBridges: 1,
  maxHoleSize: 1,
  processSameFile: false,
  maxFileBytes: 1_000_000,
};

function normalizePath(p: string): string {
  return p.replaceAll('\\', '/');
}

function normalizeLine(line: string): string {
  return line.toLowerCase().replace(/\s+/g, '').trim();
}

function splitTokens(input: string): string[] {
  const tokens = input.match(/[a-z0-9_]+/gi) ?? [];
  if (tokens.length > 0) return tokens;
  return input.length > 0 ? [input] : [];
}

function fnv1a64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.codePointAt(i) ?? 0);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash;
}

function tryCandidateGap(
  fileA: IndexedLine[],
  fileB: IndexedLine[],
  i: number,
  j: number,
  fuzz: number
): boolean {
  if (i >= fileA.length || j >= fileB.length) {
    return false;
  }
  return isSimilarLine(fileA[i], fileB[j], fuzz);
}

function simhash64(line: string): bigint {
  if (!line) return 0n;
  const tokens = splitTokens(line);
  const vector = new Int32Array(64);
  for (const token of tokens) {
    const h = fnv1a64(token);
    for (let bit = 0; bit < 64; bit++) {
      const isSet = (h & (1n << BigInt(bit))) !== 0n;
      vector[bit] += isSet ? 1 : -1;
    }
  }

  let out = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (vector[bit] >= 0) {
      out |= 1n << BigInt(bit);
    }
  }
  return out;
}

function simhashBands(hash: bigint): number[] {
  return [
    Number(hash & 0xffffn),
    Number((hash >> 16n) & 0xffffn),
    Number((hash >> 32n) & 0xffffn),
    Number((hash >> 48n) & 0xffffn),
  ];
}

function hammingDistance64(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b);
  let count = 0;
  while (x !== 0n) {
    count++;
    x &= x - 1n;
  }
  return count;
}

function parseFileExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

async function discoverFilesAsync(
  rootDir: string,
  includeExtensions: Set<string>,
  excludePatterns: string[]
): Promise<string[]> {
  const out: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(currentPath, entry.name);
      const normalized = normalizePath(path.relative(rootDir, absolute));

      if (excludePatterns.some((pattern) => normalized.includes(pattern))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = parseFileExtension(absolute);
      if (includeExtensions.has(ext)) {
        out.push(absolute);
      }
    }
  }

  await walk(rootDir);
  return out;
}

function isSimilarLine(a: IndexedLine, b: IndexedLine, fuzz: number): boolean {
  if (a.norm.length === 0 || b.norm.length === 0) {
    return false;
  }
  if (fuzz <= 0) {
    return a.norm === b.norm;
  }
  return hammingDistance64(a.simhash, b.simhash) <= fuzz;
}

function pickGapCandidate(
  fileA: IndexedLine[],
  fileB: IndexedLine[],
  fromI: number,
  fromJ: number,
  gapTolerance: number,
  fuzz: number
): { i: number; j: number } | null {
  let best: { i: number; j: number } | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let di = 0; di <= gapTolerance; di++) {
    for (let dj = 0; dj <= gapTolerance; dj++) {
      if (di === 0 && dj === 0) continue;
      const i = fromI + di;
      const j = fromJ + dj;
      if (!tryCandidateGap(fileA, fileB, i, j, fuzz)) continue;
      const cost = di + dj;
      if (cost < bestCost) {
        bestCost = cost;
        best = { i, j };
      }
    }
  }

  return best;
}

function shouldSkipSameFilePosition(sameFile: boolean, i: number, j: number): boolean {
  return sameFile && j <= i;
}

function advanceWithHole(
  holesUsed: number,
  maxHoleSize: number,
  i: number,
  j: number,
  maxHolesSeen: number
): { advanced: boolean; i: number; j: number; holesUsed: number; maxHolesSeen: number } {
  if (holesUsed >= maxHoleSize) {
    return { advanced: false, i, j, holesUsed, maxHolesSeen };
  }

  const nextHoles = holesUsed + 1;
  return {
    advanced: true,
    i: i + 1,
    j: j + 1,
    holesUsed: nextHoles,
    maxHolesSeen: Math.max(maxHolesSeen, nextHoles),
  };
}

function bridgeGapIfPossible(input: GapBridgeInput): {
  bridged: boolean;
  i: number;
  j: number;
  gapBridges: number;
  gapCount: number;
} {
  const { fileA, fileB, i, j, gapTolerance, fuzz, gapBridges, maxGapBridges, gapCount } = input;
  if (gapBridges >= maxGapBridges || gapTolerance <= 0) {
    return { bridged: false, i, j, gapBridges, gapCount };
  }

  const bridged = pickGapCandidate(fileA, fileB, i, j, gapTolerance, fuzz);
  if (!bridged) {
    return { bridged: false, i, j, gapBridges, gapCount };
  }

  return {
    bridged: true,
    i: bridged.i,
    j: bridged.j,
    gapBridges: gapBridges + 1,
    gapCount: gapCount + Math.max(bridged.i - i, bridged.j - j),
  };
}

function findBlockFromAnchor(
  fileA: IndexedLine[],
  fileB: IndexedLine[],
  anchorI: number,
  anchorJ: number,
  opts: Required<Omit<FuzzyDuplicateOptions, 'rootDir'>>,
  sameFile: boolean
): BlockMatch | null {
  let i = anchorI;
  let j = anchorJ;
  let matchingLines = 0;
  let holesUsed = 0;
  let maxHolesSeen = 0;
  let gapBridges = 0;
  let gapCount = 0;
  let endI = anchorI - 1;
  let endJ = anchorJ - 1;

  while (i < fileA.length && j < fileB.length) {
    if (shouldSkipSameFilePosition(sameFile, i, j)) {
      j++;
      continue;
    }

    if (isSimilarLine(fileA[i], fileB[j], opts.fuzz)) {
      matchingLines++;
      endI = i;
      endJ = j;
      i++;
      j++;
      holesUsed = 0;
      continue;
    }

    const holeAdvance = advanceWithHole(holesUsed, opts.maxHoleSize, i, j, maxHolesSeen);
    if (holeAdvance.advanced) {
      i = holeAdvance.i;
      j = holeAdvance.j;
      holesUsed = holeAdvance.holesUsed;
      maxHolesSeen = holeAdvance.maxHolesSeen;
      continue;
    }

    const gapBridge = bridgeGapIfPossible({
      fileA,
      fileB,
      i,
      j,
      gapTolerance: opts.gapTolerance,
      fuzz: opts.fuzz,
      gapBridges,
      maxGapBridges: opts.maxGapBridges,
      gapCount,
    });

    if (gapBridge.bridged) {
      i = gapBridge.i;
      j = gapBridge.j;
      gapBridges = gapBridge.gapBridges;
      gapCount = gapBridge.gapCount;
      holesUsed = 0;
      continue;
    }

    break;
  }

  if (matchingLines < opts.minMatchLength) {
    return null;
  }

  return {
    startI: anchorI,
    endI,
    startJ: anchorJ,
    endJ,
    matchingLines,
    gapCount,
    holeCount: maxHolesSeen,
  };
}

function isAnchorCoveredByBlock(i: number, j: number, block: BlockMatch): boolean {
  return i >= block.startI && i <= block.endI && j >= block.startJ && j <= block.endJ;
}

function buildBandIndex(lines: IndexedLine[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j];
    if (!line.norm) continue;
    for (let band = 0; band < line.bands.length; band++) {
      const key = `${band}:${line.bands[band]}`;
      const bucket = index.get(key);
      if (bucket) {
        bucket.push(j);
      } else {
        index.set(key, [j]);
      }
    }
  }
  return index;
}

function collectCandidateAnchors(
  fileA: IndexedLine[],
  fileB: IndexedLine[],
  indexB: Map<string, number[]>,
  fuzz: number,
  sameFile: boolean
): Array<{ i: number; j: number }> {
  const anchors: Array<{ i: number; j: number }> = [];

  const collectCandidatesForLine = (line: IndexedLine): Set<number> => {
    const candidates = new Set<number>();
    for (let band = 0; band < line.bands.length; band++) {
      const key = `${band}:${line.bands[band]}`;
      const bucket = indexB.get(key);
      if (!bucket) continue;
      for (const j of bucket) candidates.add(j);
    }
    return candidates;
  };

  const tryAddAnchor = (i: number, j: number, line: IndexedLine): void => {
    if (shouldSkipSameFilePosition(sameFile, i, j)) return;
    if (!isSimilarLine(line, fileB[j], fuzz)) return;
    anchors.push({ i, j });
  };

  for (let i = 0; i < fileA.length; i++) {
    const line = fileA[i];
    if (!line.norm) continue;

    const candidateJs = collectCandidatesForLine(line);
    for (const j of candidateJs) tryAddAnchor(i, j, line);
  }

  anchors.sort((a, b) => (a.i === b.i ? a.j - b.j : a.i - b.i));
  return anchors;
}

function detectBlocksBetweenFiles(
  fileA: LoadedFile,
  fileB: LoadedFile,
  opts: Required<Omit<FuzzyDuplicateOptions, 'rootDir'>>,
  sameFile: boolean
): BlockMatch[] {
  const indexB = buildBandIndex(fileB.indexedLines);
  const anchors = collectCandidateAnchors(
    fileA.indexedLines,
    fileB.indexedLines,
    indexB,
    opts.fuzz,
    sameFile
  );

  const blocks: BlockMatch[] = [];
  for (const anchor of anchors) {
    if (blocks.some((block) => isAnchorCoveredByBlock(anchor.i, anchor.j, block))) {
      continue;
    }
    const block = findBlockFromAnchor(
      fileA.indexedLines,
      fileB.indexedLines,
      anchor.i,
      anchor.j,
      opts,
      sameFile
    );
    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

async function loadEligibleFilesAsync(
  rootDir: string,
  includeExt: Set<string>,
  excludePatterns: string[],
  maxFileBytes: number
): Promise<LoadedFile[]> {
  const discovered = await discoverFilesAsync(rootDir, includeExt, excludePatterns);
  const loadedFiles: LoadedFile[] = [];

  for (const absolutePath of discovered) {
    const stat = await fs.stat(absolutePath);
    if (stat.size > maxFileBytes) {
      continue;
    }

    const content = await fs.readFile(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const indexedLines = lines.map((line) => {
      const norm = normalizeLine(line);
      const simhash = simhash64(norm);
      return {
        norm,
        simhash,
        bands: simhashBands(simhash),
      } satisfies IndexedLine;
    });

    loadedFiles.push({
      absolutePath,
      relativePath: normalizePath(path.relative(rootDir, absolutePath)),
      lines,
      indexedLines,
    });
  }

  return loadedFiles;
}

function updateLineSet(map: Map<string, Set<number>>, filePath: string, line: number): void {
  const set = map.get(filePath);
  if (set) {
    set.add(line);
  } else {
    map.set(filePath, new Set([line]));
  }
}

function updateMatches(
  map: Map<string, FuzzyDuplicateMatch[]>,
  filePath: string,
  match: FuzzyDuplicateMatch
): void {
  const list = map.get(filePath);
  if (list) {
    list.push(match);
  } else {
    map.set(filePath, [match]);
  }
}

function asForwardMatch(block: BlockMatch, targetPath: string): FuzzyDuplicateMatch {
  return {
    sourceStartLine: block.startI + 1,
    sourceEndLine: block.endI + 1,
    targetFile: targetPath,
    targetStartLine: block.startJ + 1,
    targetEndLine: block.endJ + 1,
    matchingLines: block.matchingLines,
    gapCount: block.gapCount,
    holeCount: block.holeCount,
  };
}

function asReverseMatch(block: BlockMatch, targetPath: string): FuzzyDuplicateMatch {
  return {
    sourceStartLine: block.startJ + 1,
    sourceEndLine: block.endJ + 1,
    targetFile: targetPath,
    targetStartLine: block.startI + 1,
    targetEndLine: block.endI + 1,
    matchingLines: block.matchingLines,
    gapCount: block.gapCount,
    holeCount: block.holeCount,
  };
}

function detectAcrossAllPairs(
  loadedFiles: LoadedFile[],
  resolved: Required<Omit<FuzzyDuplicateOptions, 'rootDir'>>,
  duplicatedLinesByFile: Map<string, Set<number>>,
  matchesByFile: Map<string, FuzzyDuplicateMatch[]>
): { comparedPairs: number; matchBlocks: number } {
  let comparedPairs = 0;
  let matchBlocks = 0;

  const processPair = (fileA: LoadedFile, fileB: LoadedFile, sameFile: boolean): number => {
    const blocks = detectBlocksBetweenFiles(fileA, fileB, resolved, sameFile);

    for (const block of blocks) {
      for (let line = block.startI; line <= block.endI; line++) {
        updateLineSet(duplicatedLinesByFile, fileA.relativePath, line + 1);
      }
      for (let line = block.startJ; line <= block.endJ; line++) {
        updateLineSet(duplicatedLinesByFile, fileB.relativePath, line + 1);
      }

      updateMatches(matchesByFile, fileA.relativePath, asForwardMatch(block, fileB.relativePath));

      if (!sameFile) {
        updateMatches(matchesByFile, fileB.relativePath, asReverseMatch(block, fileA.relativePath));
      }
    }

    return blocks.length;
  };

  for (let i = 0; i < loadedFiles.length; i++) {
    for (let j = resolved.processSameFile ? i : i + 1; j < loadedFiles.length; j++) {
      const fileA = loadedFiles[i];
      const fileB = loadedFiles[j];
      const sameFile = i === j;
      if (sameFile && !resolved.processSameFile) continue;

      comparedPairs++;
      matchBlocks += processPair(fileA, fileB, sameFile);
    }
  }

  return { comparedPairs, matchBlocks };
}

function mergeOptions(
  options: FuzzyDuplicateOptions | undefined
): Required<Omit<FuzzyDuplicateOptions, 'rootDir'>> & { rootDir: string } {
  const rootDir = path.resolve(options?.rootDir ?? process.cwd());
  return {
    rootDir,
    includeExtensions: options?.includeExtensions ?? DEFAULT_OPTIONS.includeExtensions,
    excludePatterns: options?.excludePatterns ?? DEFAULT_OPTIONS.excludePatterns,
    minMatchLength: options?.minMatchLength ?? DEFAULT_OPTIONS.minMatchLength,
    fuzz: options?.fuzz ?? DEFAULT_OPTIONS.fuzz,
    gapTolerance: options?.gapTolerance ?? DEFAULT_OPTIONS.gapTolerance,
    maxGapBridges: options?.maxGapBridges ?? DEFAULT_OPTIONS.maxGapBridges,
    maxHoleSize: options?.maxHoleSize ?? DEFAULT_OPTIONS.maxHoleSize,
    processSameFile: options?.processSameFile ?? DEFAULT_OPTIONS.processSameFile,
    maxFileBytes: options?.maxFileBytes ?? DEFAULT_OPTIONS.maxFileBytes,
  };
}

export async function detectFuzzyDuplicatesAsync(
  options?: FuzzyDuplicateOptions
): Promise<FuzzyDuplicateReport> {
  const resolved = mergeOptions(options);
  const includeExt = new Set(resolved.includeExtensions.map((ext) => ext.toLowerCase()));
  const loadedFiles = await loadEligibleFilesAsync(
    resolved.rootDir,
    includeExt,
    resolved.excludePatterns,
    resolved.maxFileBytes
  );

  const duplicatedLinesByFile = new Map<string, Set<number>>();
  const matchesByFile = new Map<string, FuzzyDuplicateMatch[]>();

  const { comparedPairs, matchBlocks } = detectAcrossAllPairs(
    loadedFiles,
    resolved,
    duplicatedLinesByFile,
    matchesByFile
  );

  const files: FuzzyDuplicateFileResult[] = loadedFiles
    .map((file) => {
      const duplicated = duplicatedLinesByFile.get(file.relativePath)?.size ?? 0;
      const totalLines = file.lines.length;
      return {
        path: file.relativePath,
        totalLines,
        duplicateLines: duplicated,
        duplicatePercent: totalLines > 0 ? (duplicated / totalLines) * 100 : 0,
        matches: matchesByFile.get(file.relativePath) ?? [],
      } satisfies FuzzyDuplicateFileResult;
    })
    .sort((a, b) => b.duplicatePercent - a.duplicatePercent);

  const totalDuplicateLines = files.reduce((sum, file) => sum + file.duplicateLines, 0);

  return {
    files,
    summary: {
      totalDuplicateLines,
      totalFiles: files.length,
      comparedPairs,
      matchBlocks,
    },
    options: resolved,
  };
}

export function formatFuzzyDuplicateReport(report: FuzzyDuplicateReport): string {
  const lines: string[] = [];
  for (const file of report.files) {
    if (file.matches.length === 0) continue;
    lines.push(
      `${file.path}: ${file.duplicateLines}/${file.totalLines} duplicated lines (${file.duplicatePercent.toFixed(2)}%)`
    );
    const shown = file.matches.slice(0, 20);
    for (const match of shown) {
      lines.push(
        `  lines ${match.sourceStartLine}-${match.sourceEndLine} ~ ${match.targetStartLine}-${match.targetEndLine} in ${match.targetFile}` +
          ` (matching ${match.matchingLines}, holes ${match.holeCount}, gaps ${match.gapCount})`
      );
    }
    if (file.matches.length > shown.length) {
      lines.push(`  ... ${file.matches.length - shown.length} more matches`);
    }
    lines.push('');
  }

  lines.push(
    `Summary: ${report.summary.totalDuplicateLines} duplicate lines, ${report.summary.matchBlocks} match blocks, ${report.summary.totalFiles} files, ${report.summary.comparedPairs} pairs`
  );

  return lines.join('\n');
}

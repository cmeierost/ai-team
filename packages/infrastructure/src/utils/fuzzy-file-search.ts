import { levenshtein } from './str.js';

function dirPart(input: string): string {
  const normalized = input.toLowerCase();
  const separator = normalized.lastIndexOf('/');
  return separator === -1 ? '' : normalized.slice(0, separator);
}

/**
 * Score a candidate file path against a requested path using a combination
 * of Levenshtein distance on the basename and path prefix matching.
 *
 * Returns a score between 0 (no match) and 1 (identical).
 */
function scoreCandidate(requestedPath: string, candidatePath: string): number {
  const reqBase = requestedPath.split('/').pop()?.toLowerCase() ?? '';
  const candBase = candidatePath.split('/').pop()?.toLowerCase() ?? '';

  if (!reqBase || !candBase) return 0;

  // Exact match
  if (reqBase === candBase) {
    // Bonus if the directory also matches
    const reqDir = dirPart(requestedPath);
    const candDir = dirPart(candidatePath);
    return reqDir === candDir ? 1 : 0.9;
  }

  // Levenshtein similarity on basename
  const maxLen = Math.max(reqBase.length, candBase.length);
  const baseSimilarity = maxLen === 0 ? 0 : 1 - levenshtein(reqBase, candBase) / maxLen;

  // Substring bonus
  const hasSubstring = candBase.includes(reqBase) || reqBase.includes(candBase);
  const substringBonus = hasSubstring ? 0.1 : 0;

  // Shared path prefix bonus (e.g., same directory)
  const reqDir = dirPart(requestedPath);
  const candDir = dirPart(candidatePath);
  const sameDir = reqDir === candDir ? 0.15 : 0;

  // Extension match bonus
  const reqExt = reqBase.includes('.') ? reqBase.slice(reqBase.lastIndexOf('.')) : '';
  const candExt = candBase.includes('.') ? candBase.slice(candBase.lastIndexOf('.')) : '';
  const extMatch = reqExt && candExt && reqExt === candExt ? 0.05 : 0;

  return Math.min(1, baseSimilarity + substringBonus + sameDir + extMatch);
}

/**
 * Find the top N files from an allowed file list that are most similar to
 * the requested path.
 *
 * Only files from the provided `allowedFiles` set are considered — this is
 * the permission boundary. Callers should pass the agent's readable file list.
 *
 * @param requestedPath  - The path the user/agent tried to read (workspace-relative).
 * @param allowedFiles   - Workspace-relative paths the agent is allowed to read.
 * @param maxResults     - Maximum number of suggestions (default 10).
 * @param minScore       - Minimum similarity score to include (default 0.3).
 */
export function findSimilarFiles(
  requestedPath: string,
  allowedFiles: readonly string[],
  maxResults = 10,
  minScore = 0.3
): string[] {
  return rankSimilarFiles(requestedPath, allowedFiles, minScore)
    .slice(0, maxResults)
    .map((s) => s.path);
}

/**
 * Return all fuzzy matches above the threshold, ranked best-first.
 */
export function rankSimilarFiles(
  requestedPath: string,
  allowedFiles: readonly string[],
  minScore = 0.3
): Array<{ path: string; score: number }> {
  const scored: Array<{ path: string; score: number }> = [];

  for (const file of allowedFiles) {
    const score = scoreCandidate(requestedPath, file);
    if (score >= minScore) {
      scored.push({ path: file, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored;
}

import type { LspDiagnostic, LspProvider } from '@ai-team/core';

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2, hint: 3 };
const MAX_DIAGNOSTICS = 20;
const DEFAULT_DELAY_MS = 500;

export async function collectPostWriteDiagnostics(
  lsp: LspProvider | undefined,
  filePaths: string[],
  delayMs: number = DEFAULT_DELAY_MS
): Promise<LspDiagnostic[] | undefined> {
  if (!lsp?.isAvailable()) return undefined;

  // Give the language server time to process the new file contents.
  if (delayMs > 0) {
    await new Promise<void>((r) => setTimeout(r, delayMs));
  }

  const unique = [...new Set(filePaths)];
  const all: LspDiagnostic[] = [];

  for (const filePath of unique) {
    try {
      const result = await lsp.execute('getDiagnostics', { filePath });
      if (result.kind === 'diagnostics') {
        all.push(...result.diagnostics);
      }
    } catch {
      // Diagnostics are best-effort; don't fail the tool on LSP errors.
    }
  }

  if (all.length === 0) return undefined;

  // Sort: errors first, then warnings, then info, then hint.
  all.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  return all.slice(0, MAX_DIAGNOSTICS);
}

import path from 'node:path';
import { z } from 'zod';
import { Ripgrep } from 'fs-context';
import type {
  LspOperation,
  LspProvider,
  LspResult,
  ExecutionContext,
  ITypeScriptAnalyzer,
  ICodeEditManager,
  CommandResponse,
  ICommand,
  IIdeAdapterFactory,
} from '@ai-team/core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPathPermissionChecker(context: ExecutionContext) {
  const checker = (context as any).pathPermissionChecker;
  if (!checker) {
    throw new Error('ExecutionContext.pathPermissionChecker is required for code tools.');
  }
  return checker;
}

class LspResolver {
  constructor(
    private readonly workspaceRoot: string,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {}

  async resolve(context: ExecutionContext): Promise<LspProvider> {
    const channel = context.invocationSurface === 'cli' ? 'cli' : 'web';
    const adapter = await this.ideAdapterFactory.createAsync(this.workspaceRoot, channel);
    return adapter.lsp;
  }
}

function formatLspResult(result: LspResult): Record<string, unknown> {
  switch (result.kind) {
    case 'locations':
      return result.locations.length === 0
        ? { message: 'No results found' }
        : { count: result.locations.length, locations: result.locations };
    case 'symbols':
      return result.symbols.length === 0
        ? { message: 'No symbols found' }
        : { count: result.symbols.length, symbols: result.symbols };
    case 'hover':
      return result.hover.contents
        ? { contents: result.hover.contents }
        : { message: 'No hover information available' };
    case 'callItems':
      return result.items.length === 0
        ? { message: 'No call hierarchy items found' }
        : { count: result.items.length, items: result.items };
    case 'diagnostics':
      return result.diagnostics.length === 0
        ? { message: 'No diagnostics found' }
        : { count: result.diagnostics.length, diagnostics: result.diagnostics };
    default:
      return { message: 'Unsupported LSP result kind', result };
  }
}

function filterSymbolsByName(symbols: any[], name: string): any[] {
  const lower = name.toLowerCase();
  const matches: any[] = [];
  for (const sym of symbols) {
    if (sym.name.toLowerCase().includes(lower)) matches.push(sym);
    if (sym.children) matches.push(...filterSymbolsByName(sym.children, name));
  }
  return matches;
}

type LspFormatInput = Record<string, unknown>;

function flattenSymbols(
  syms: Array<{ name: string; kind: string; path: string; line: number; children?: unknown[] }>,
  indent = ''
): string[] {
  const out: string[] = [];
  for (const s of syms) {
    out.push(`${indent}${s.path}:${s.line} — ${s.name} (${s.kind})`);
    if (s.children?.length) out.push(...flattenSymbols(s.children as typeof syms, indent + '  '));
  }
  return out;
}

function formatLspForLlm(r: LspFormatInput): unknown {
  const locs = r['locations'] as
    | Array<{ path: string; line: number; character: number; preview?: string }>
    | undefined;
  const syms = r['symbols'] as
    | Array<{ name: string; kind: string; path: string; line: number; children?: unknown[] }>
    | undefined;
  const items = r['items'] as
    | Array<{ name: string; kind: string; path: string; line: number }>
    | undefined;
  const diags = r['diagnostics'] as
    | Array<{ path: string; line: number; severity: string; message: string }>
    | undefined;
  let opValue = '';
  if (r['operation']) {
    if (typeof r['operation'] === 'string') {
      opValue = r['operation'];
    } else {
      opValue = JSON.stringify(r['operation']);
    }
  }
  const op = opValue ? `operation: ${opValue}\n` : '';
  if (locs) {
    const lines = locs.map((l) => {
      const preview = l.preview ? ` — ${l.preview.trim()}` : '';
      return `${l.path}:${l.line}:${l.character}${preview}`;
    });
    return `${op}${locs.length} locations\n\n${lines.join('\n')}`;
  }
  if (syms) {
    return `${op}${syms.length} symbols\n\n${flattenSymbols(syms).join('\n')}`;
  }
  if (items) {
    const lines = items.map((i) => `${i.path}:${i.line} — ${i.name} (${i.kind})`);
    return `${op}${items.length} call items\n\n${lines.join('\n')}`;
  }
  if (diags) {
    const lines = diags.map((d) => `${d.path}:${d.line} [${d.severity}] ${d.message}`);
    return `${op}${diags.length} diagnostics\n\n${lines.join('\n')}`;
  }
  return JSON.stringify(r, null, 2);
}

// ─── FindSymbol ───────────────────────────────────────────────────────────────

export interface FindSymbolParams {
  symbolName: string;
  filePath?: string;
  line?: number;
  character?: number;
}

export class FindSymbolTool implements ICommand<FindSymbolParams, unknown> {
  readonly name = 'find_symbol';
  readonly key = 'find_symbol';
  readonly group = 'code';
  readonly availableIn = { tool: true };
  readonly description =
    'Find symbol definitions (functions, classes, variables) via the connected IDE language server. Requires read permission.';
  readonly parameters = z.object({
    symbolName: z.string().describe('Name of the symbol to find'),
    filePath: z.string().optional().describe('File to search in (omit for workspace-wide search)'),
    line: z
      .number()
      .int()
      .optional()
      .describe('1-based line number (for go-to-definition from a usage site)'),
    character: z
      .number()
      .int()
      .optional()
      .describe('0-based column (for go-to-definition from a usage site)'),
  });

  formatForLlm(result: unknown): unknown {
    return formatLspForLlm(result as LspFormatInput);
  }

  constructor(
    private readonly workspaceRoot: string,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {
    this.lspResolver = new LspResolver(this.workspaceRoot, this.ideAdapterFactory);
  }

  private readonly lspResolver: LspResolver;

  async execute(
    params: FindSymbolParams,
    context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const { symbolName, filePath, line, character } = params;
    const lsp = await this.lspResolver.resolve(context);
    if (!lsp?.isAvailable()) {
      return {
        status: 'error',
        error: {
          message:
            'No IDE language server connected. Connect the VS Code extension for LSP-based symbol finding.',
        },
        data: { symbolName, filePath },
      };
    }

    if (filePath && line != null && character != null) {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(context.workspaceRoot, filePath);
      const result = await lsp.execute('goToDefinition', {
        filePath: absPath,
        line: line - 1,
        character,
      });
      return { status: 'ok', data: { symbolName, ...formatLspResult(result) } };
    }

    if (filePath) {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(context.workspaceRoot, filePath);
      const result = await lsp.execute('documentSymbol', { filePath: absPath });
      if (result.kind === 'symbols') {
        const filtered = filterSymbolsByName(result.symbols, symbolName);
        return {
          status: 'ok',
          data: { symbolName, count: filtered.length, symbols: filtered },
        };
      }
      return { status: 'ok', data: { symbolName, ...formatLspResult(result) } };
    }

    const result = await lsp.execute('workspaceSymbol', { filePath: '', query: symbolName });
    return { status: 'ok', data: { symbolName, ...formatLspResult(result) } };
  }
}

// ─── FindReferences ───────────────────────────────────────────────────────────

export interface FindReferencesParams {
  filePath: string;
  line: number;
  character: number;
}

export class FindReferencesTool implements ICommand<FindReferencesParams, unknown> {
  readonly name = 'find_references';
  readonly key = 'find_references';
  readonly group = 'code';
  readonly availableIn = { tool: true };
  readonly description =
    'Find all references/usages of a symbol via the connected IDE language server. Position the cursor on a symbol usage to find all other references. Requires read permission.';
  readonly parameters = z.object({
    filePath: z.string().describe('File containing the symbol'),
    line: z.number().int().describe('1-based line number of the symbol'),
    character: z.number().int().describe('0-based column of the symbol'),
  });

  formatForLlm(result: unknown): unknown {
    return formatLspForLlm(result as LspFormatInput);
  }

  constructor(
    private readonly workspaceRoot: string,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {
    this.lspResolver = new LspResolver(this.workspaceRoot, this.ideAdapterFactory);
  }

  private readonly lspResolver: LspResolver;

  async execute(
    params: FindReferencesParams,
    context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const { filePath, line, character } = params;
    const lsp = await this.lspResolver.resolve(context);
    if (!lsp?.isAvailable()) {
      return {
        status: 'error',
        error: {
          message:
            'No IDE language server connected. Connect the VS Code extension for LSP-based reference finding.',
        },
        data: { filePath, line },
      };
    }

    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);
    const result = await lsp.execute('findReferences', {
      filePath: absPath,
      line: line - 1,
      character,
    });
    return { status: 'ok', data: formatLspResult(result) };
  }
}

// ─── Lsp ──────────────────────────────────────────────────────────────────────

export interface LspParams {
  operation: LspOperation;
  filePath: string;
  line?: number;
  character?: number;
  query?: string;
}

export class LspTool implements ICommand<LspParams, unknown> {
  readonly name = 'lsp';
  readonly key = 'lsp';
  readonly group = 'code';
  readonly availableIn = { tool: true };
  readonly description =
    'Execute a language server operation (goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls, getDiagnostics) via the connected IDE. Lines are 1-based.';
  readonly parameters = z.object({
    operation: z
      .enum([
        'goToDefinition',
        'findReferences',
        'hover',
        'documentSymbol',
        'workspaceSymbol',
        'goToImplementation',
        'prepareCallHierarchy',
        'incomingCalls',
        'outgoingCalls',
        'getDiagnostics',
      ])
      .describe('LSP operation to execute'),
    filePath: z.string().describe('File path (relative or absolute)'),
    line: z.number().int().optional().describe('1-based line number'),
    character: z.number().int().optional().describe('0-based column'),
    query: z.string().optional().describe('Query string (for workspaceSymbol)'),
  });

  formatForLlm(result: unknown): unknown {
    return formatLspForLlm(result as LspFormatInput);
  }

  constructor(
    private readonly workspaceRoot: string,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {
    this.lspResolver = new LspResolver(this.workspaceRoot, this.ideAdapterFactory);
  }

  private readonly lspResolver: LspResolver;

  async execute(params: LspParams, context: ExecutionContext): Promise<CommandResponse<unknown>> {
    const { operation, filePath, line, character, query } = params;
    const lsp = await this.lspResolver.resolve(context);
    if (!lsp?.isAvailable()) {
      return {
        status: 'error',
        error: {
          message:
            'No IDE language server connected. Start the VS Code extension to enable LSP operations.',
        },
        data: { operation },
      };
    }

    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);
    const result = await lsp.execute(operation, {
      filePath: absPath,
      line: line == null ? undefined : line - 1,
      character,
      query,
    });
    return { status: 'ok', data: { operation, ...formatLspResult(result) } };
  }
}

// ─── GrepCode ─────────────────────────────────────────────────────────────────

export interface GrepCodeParams {
  pattern: string;
  filePatterns?: string[];
  caseSensitive?: boolean;
  limit?: number;
}

export interface GrepCodeResult {
  pattern: string;
  matchCount: number;
  fileCount: number;
  matches: Array<{
    filePath: string;
    lineNumber: number;
    line: string;
    submatches: string[];
  }>;
}

export class GrepCodeTool implements ICommand<GrepCodeParams, GrepCodeResult> {
  readonly name = 'grep';
  readonly key = 'grep';
  readonly group = 'search';
  readonly availableIn = { tool: true };
  readonly description =
    'Fast regex or literal text search in workspace files, powered by ripgrep. Returns structured match objects with file path, line number, and matched content. Requires read permission.';
  readonly parameters = z.object({
    pattern: z.string().describe('Regex or literal text to search for'),
    filePatterns: z
      .array(z.string())
      .optional()
      .describe('Glob patterns to restrict files (e.g. ["**/*.ts"])'),
    caseSensitive: z
      .boolean()
      .optional()
      .describe('Force case-sensitive match (default: ripgrep smart-case)'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Max matches to return per file (default: unlimited)'),
  });

  formatForLlm(result: unknown): unknown {
    const r = result as GrepCodeResult;
    const header = `pattern: ${r.pattern}\n${r.matchCount} matches in ${r.fileCount} files`;
    if (!r.matches?.length) return header;
    const lines = r.matches.map((m) => `${m.filePath}:${m.lineNumber}: ${m.line}`);
    return `${header}\n\n${lines.join('\n')}`;
  }

  async execute(
    params: GrepCodeParams,
    context: ExecutionContext
  ): Promise<CommandResponse<GrepCodeResult>> {
    const { pattern, filePatterns, limit } = params;
    const matches = await Ripgrep.search({
      cwd: context.workspaceRoot,
      pattern,
      glob: filePatterns,
      limit,
      follow: false,
    });

    return {
      status: 'ok',
      data: {
        pattern,
        matchCount: matches.length,
        fileCount: new Set(matches.map((m) => m.path.text)).size,
        matches: matches.slice(0, 200).map((m) => ({
          filePath: m.path.text,
          lineNumber: m.line_number,
          line: m.lines.text.trimEnd(),
          submatches: m.submatches.map((s) => s.match.text),
        })),
      },
    };
  }
}

// ─── AnalyzeComplexity ────────────────────────────────────────────────────────

export interface AnalyzeComplexityParams {
  filePath: string;
  functionName?: string;
}

export class AnalyzeComplexityTool {
  readonly name = 'complexity';
  readonly key = 'complexity';
  readonly group = 'code';
  readonly availableIn = { tool: true };
  readonly description =
    'Analyze code complexity metrics (cyclomatic complexity, LOC, etc.) for TypeScript/JavaScript files. Requires read permission.';
  readonly parameters = z.object({
    filePath: z.string().describe('File path to analyze'),
    functionName: z
      .string()
      .optional()
      .describe('Specific function to analyze (omit for all functions)'),
  });

  constructor(private readonly analyzer: ITypeScriptAnalyzer) {}

  formatForLlm(result: unknown): unknown {
    const r = result as any;
    if (r.functionName && r.complexity) {
      const c = r.complexity;
      return `${r.filePath} — ${r.functionName}\ncyclo=${c.cyclomaticComplexity}  loc=${c.linesOfCode}  params=${c.parameters}  depth=${c.nestedDepth}`;
    }
    if (r.functions) {
      const lines = r.functions.map((f: any) => {
        const c = f.complexity;
        const flags = [f.isAsync ? 'async' : '', f.isExported ? 'export' : '']
          .filter(Boolean)
          .join(' ');
        const flagSuffix = flags ? ` (${flags})` : '';
        return `L${f.startLine}  ${f.name}${flagSuffix}  cyclo=${c.cyclomaticComplexity}  loc=${c.linesOfCode}  depth=${c.nestedDepth}`;
      });
      return `${r.filePath}  ${r.functions.length} functions\n\n${lines.join('\n')}`;
    }
    return JSON.stringify(result, null, 2);
  }

  async execute(params: AnalyzeComplexityParams, context: ExecutionContext): Promise<unknown> {
    const { filePath, functionName } = params;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    getPathPermissionChecker(context);

    if (functionName) {
      const complexity = await this.analyzer.calculateComplexity(absolutePath, functionName);
      return { filePath, functionName, complexity };
    } else {
      const functions = await this.analyzer.getFunctions(absolutePath);
      return { filePath, functions };
    }
  }
}

// ─── ApplyCodeEdit ────────────────────────────────────────────────────────────

export interface ApplyCodeEditParams {
  description: string;
  changes: Array<{
    filePath: string;
    oldContent: string;
    newContent: string;
  }>;
}

export class ApplyCodeEditTool {
  readonly name = 'apply_patch';
  readonly key = 'apply_patch';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description =
    'Propose code changes to one or more files. Changes must be approved by the user before being applied. Requires write permission for all files.';
  readonly parameters = z.object({
    description: z.string().describe('Clear description of what changes are being made and why'),
    changes: z
      .array(
        z.object({
          filePath: z.string().describe('File path (relative or absolute)'),
          oldContent: z.string().describe('Current content of the file'),
          newContent: z.string().describe('New content after changes'),
        })
      )
      .min(1)
      .describe('List of file changes to apply'),
  });

  constructor(private readonly editManager: ICodeEditManager) {}

  async execute(params: ApplyCodeEditParams, context: ExecutionContext): Promise<unknown> {
    const { description, changes } = params;

    const absoluteChanges = changes.map((change) => ({
      ...change,
      filePath: path.isAbsolute(change.filePath)
        ? change.filePath
        : path.join(context.workspaceRoot, change.filePath),
    }));

    const filePaths = absoluteChanges.map((c) => c.filePath);
    const checker = getPathPermissionChecker(context);
    const blockedFiles = filePaths.filter(
      (fp: string) => !checker.canWritePath(context.agent!.permissions, fp)
    );

    if (blockedFiles.length > 0) {
      return {
        status: 'permission_denied',
        message: `Agent '${context.agent!.id}' has no write access to ${blockedFiles.length} file(s).`,
        blockedFiles: blockedFiles.map((fp: string) => ({
          filePath: fp,
          reason: 'Write access denied',
        })),
      };
    }

    const { proposal, validation: proposalValidation } = await this.editManager.createProposal(
      context.agent!.id,
      { description, changes: absoluteChanges },
      { checkPermissions: true, maxFiles: 10, maxDiffLines: 500 }
    );

    return {
      status: 'pending_approval',
      proposalId: proposal.id,
      description: proposal.description,
      filesChanged: proposal.changes.length,
      additions: proposal.changes.reduce((sum: number, c: any) => sum + c.diff.additions, 0),
      deletions: proposal.changes.reduce((sum: number, c: any) => sum + c.diff.deletions, 0),
      warnings: proposalValidation.warnings,
      message: 'Code edit proposal created. Awaiting user approval.',
    };
  }
}

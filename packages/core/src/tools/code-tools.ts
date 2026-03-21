import path from 'node:path';
import { z } from 'zod';
import { Ripgrep } from '@ai-team/fs';
import type { LspOperation, LspProvider, LspResult } from '@ai-team/ide-interface';
import type { AgentTool, ToolContext } from '../types/index.js';
import { ContextManager } from '../context/index.js';

// ── Helper: resolve LspProvider from context ──────────────────────────────

function getLspProvider(context: ToolContext): LspProvider | undefined {
  return (context as any).lsp as LspProvider | undefined;
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
  }
}

/**
 * Find symbol definitions via LSP (goToDefinition + documentSymbol).
 * Falls back to tree-sitter scaffold if no LSP provider is available.
 */
export const findSymbolTool: AgentTool = {
  name: 'find_symbol',
  description: 'Find symbol definitions (functions, classes, variables) via the connected IDE language server. Requires read permission.',
  parameters: z.object({
    symbolName: z.string().describe('Name of the symbol to find'),
    filePath: z.string().optional().describe('File to search in (omit for workspace-wide search)'),
    line: z.number().int().optional().describe('1-based line number (for go-to-definition from a usage site)'),
    character: z.number().int().optional().describe('0-based column (for go-to-definition from a usage site)'),
  }),
  async execute(params, context: ToolContext) {
    const { symbolName, filePath, line, character } = params as {
      symbolName: string;
      filePath?: string;
      line?: number;
      character?: number;
    };

    const lsp = getLspProvider(context);
    if (!lsp?.isAvailable()) {
      return {
        error: 'No IDE language server connected. Connect the VS Code extension for LSP-based symbol finding.',
        symbolName,
        filePath,
      };
    }

    // If a concrete location is given, use goToDefinition
    if (filePath && line != null && character != null) {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(context.workspaceRoot, filePath);
      const result = await lsp.execute('goToDefinition', {
        filePath: absPath,
        line: line - 1, // convert 1-based to 0-based
        character,
      });
      return { symbolName, ...formatLspResult(result) };
    }

    // Otherwise use documentSymbol (single file) or workspaceSymbol (all files)
    if (filePath) {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(context.workspaceRoot, filePath);
      const result = await lsp.execute('documentSymbol', { filePath: absPath });
      // Filter by name if we got symbols back
      if (result.kind === 'symbols') {
        const filtered = filterSymbolsByName(result.symbols, symbolName);
        return { symbolName, count: filtered.length, symbols: filtered };
      }
      return { symbolName, ...formatLspResult(result) };
    }

    // Workspace-wide
    const result = await lsp.execute('workspaceSymbol', { filePath: '', query: symbolName });
    return { symbolName, ...formatLspResult(result) };
  },
};

function filterSymbolsByName(symbols: any[], name: string): any[] {
  const lower = name.toLowerCase();
  const matches: any[] = [];
  for (const sym of symbols) {
    if (sym.name.toLowerCase().includes(lower)) matches.push(sym);
    if (sym.children) matches.push(...filterSymbolsByName(sym.children, name));
  }
  return matches;
}

/**
 * Find all references to a symbol via LSP.
 */
export const findReferencesTool: AgentTool = {
  name: 'find_references',
  description: 'Find all references/usages of a symbol via the connected IDE language server. Position the cursor on a symbol usage to find all other references. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('File containing the symbol'),
    line: z.number().int().describe('1-based line number of the symbol'),
    character: z.number().int().describe('0-based column of the symbol'),
  }),
  async execute(params, context: ToolContext) {
    const { filePath, line, character } = params as {
      filePath: string;
      line: number;
      character: number;
    };

    const lsp = getLspProvider(context);
    if (!lsp?.isAvailable()) {
      return {
        error: 'No IDE language server connected. Connect the VS Code extension for LSP-based reference finding.',
        filePath,
        line,
      };
    }

    const absPath = path.isAbsolute(filePath) ? filePath : path.join(context.workspaceRoot, filePath);
    const result = await lsp.execute('findReferences', {
      filePath: absPath,
      line: line - 1, // convert 1-based to 0-based
      character,
    });
    return formatLspResult(result);
  },
};

/**
 * Unified LSP tool — exposes all 9 language server operations.
 */
export const lspTool: AgentTool = {
  name: 'lsp',
  description: 'Execute a language server operation (goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls, getDiagnostics) via the connected IDE. Lines are 1-based.',
  parameters: z.object({
    operation: z.enum([
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
    ]).describe('LSP operation to execute'),
    filePath: z.string().describe('File path (relative or absolute)'),
    line: z.number().int().optional().describe('1-based line number'),
    character: z.number().int().optional().describe('0-based column'),
    query: z.string().optional().describe('Query string (for workspaceSymbol)'),
  }),
  async execute(params, context: ToolContext) {
    const { operation, filePath, line, character, query } = params as {
      operation: LspOperation;
      filePath: string;
      line?: number;
      character?: number;
      query?: string;
    };

    const lsp = getLspProvider(context);
    if (!lsp?.isAvailable()) {
      return {
        error: 'No IDE language server connected. Start the VS Code extension to enable LSP operations.',
        operation,
      };
    }

    const absPath = path.isAbsolute(filePath) ? filePath : path.join(context.workspaceRoot, filePath);
    const result = await lsp.execute(operation, {
      filePath: absPath,
      line: line != null ? line - 1 : undefined, // convert 1-based to 0-based
      character,
      query,
    });
    return { operation, ...formatLspResult(result) };
  },
};

/**
 * Fast grep-style text search
 */
export const grepCodeTool: AgentTool = {
  name: 'search_grep',
  description: 'Fast regex or literal text search in workspace files, powered by ripgrep. Returns structured match objects with file path, line number, and matched content. Requires read permission.',
  parameters: z.object({
    pattern:       z.string().describe('Regex or literal text to search for'),
    filePatterns:  z.array(z.string()).optional().describe('Glob patterns to restrict files (e.g. ["**/*.ts"])'),
    caseSensitive: z.boolean().optional().describe('Force case-sensitive match (default: ripgrep smart-case)'),
    limit:         z.number().int().min(1).optional().describe('Max matches to return per file (default: unlimited)'),
  }),
  async execute(params, context: ToolContext) {
    const { pattern, filePatterns, limit } = params as {
      pattern: string;
      filePatterns?: string[];
      limit?: number;
    };

    const matches = await Ripgrep.search({
      cwd:     context.workspaceRoot,
      pattern,
      glob:    filePatterns,
      limit,
      follow:  false,
    });

    return {
      pattern,
      matchCount: matches.length,
      fileCount:  new Set(matches.map((m) => m.path.text)).size,
      matches: matches.slice(0, 200).map((m) => ({
        filePath:   m.path.text,
        lineNumber: m.line_number,
        line:       m.lines.text.trimEnd(),
        submatches: m.submatches.map((s) => s.match.text),
      })),
    };
  },
};

/**
 * Analyze TypeScript/JavaScript code complexity
 */
export const analyzeComplexityTool: AgentTool = {
  name: 'analyze_complexity',
  description: 'Analyze code complexity metrics (cyclomatic complexity, LOC, etc.) for TypeScript/JavaScript files. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('File path to analyze'),
    functionName: z.string().optional().describe('Specific function to analyze (omit for all functions)'),
  }),
  async execute(params, context: ToolContext) {
    const { TypeScriptAnalyzer } = await import('../code-analysis/index.js');
    const { filePath, functionName } = params as any;
    
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);
    
    const contextManager = new ContextManager(context.workspaceRoot, undefined, context.accessEngine);
    contextManager.assertCanRead(context.agent, absolutePath);
    
    const analyzer = new TypeScriptAnalyzer();
    
    if (functionName) {
      const complexity = await analyzer.calculateComplexity(absolutePath, functionName);
      return { filePath, functionName, complexity };
    } else {
      const functions = await analyzer.getFunctions(absolutePath);
      return { filePath, functions };
    }
  },
};

/**
 * Propose code edits for user approval
 */
export const applyCodeEditTool: AgentTool = {
  name: 'fs_apply_patch',
  description: 'Propose code changes to one or more files. Changes must be approved by the user before being applied. Requires write permission for all files.',
  parameters: z.object({
    description: z.string().describe('Clear description of what changes are being made and why'),
    changes: z.array(z.object({
      filePath: z.string().describe('File path (relative or absolute)'),
      oldContent: z.string().describe('Current content of the file'),
      newContent: z.string().describe('New content after changes'),
    })).min(1).describe('List of file changes to apply'),
  }),
  async execute(params, context: ToolContext) {
    const { CodeEditManager } = await import('../code-edit/index.js');
    const { description, changes } = params as any;
    
    const contextManager = new ContextManager(context.workspaceRoot, undefined, context.accessEngine);
    const editManager = new CodeEditManager();
    
    // Convert paths to absolute
    const absoluteChanges = changes.map((change: any) => ({
      ...change,
      filePath: path.isAbsolute(change.filePath)
        ? change.filePath
        : path.join(context.workspaceRoot, change.filePath),
    }));
    
    // Validate permissions for all files
    const filePaths = absoluteChanges.map((c: any) => c.filePath);
    const validation = contextManager.validateEditProposal(context.agent, filePaths);
    
    if (!validation.allowed) {
      const blockedFiles = contextManager.getBlockedFiles(context.agent, validation.blockedFiles);
      
      return {
        status: 'permission_denied',
        message: validation.message,
        blockedFiles: blockedFiles.map(bf => ({
          filePath: bf.relativePath,
          reason: bf.reason,
        })),
      };
    }
    
    // Create proposal
    const { proposal, validation: proposalValidation } = await editManager.createProposal(
      context.agent.id,
      {
        description,
        changes: absoluteChanges,
      },
      {
        checkPermissions: true,
        maxFiles: 10,
        maxDiffLines: 500,
      }
    );
    
    return {
      status: 'pending_approval',
      proposalId: proposal.id,
      description: proposal.description,
      filesChanged: proposal.changes.length,
      additions: proposal.changes.reduce((sum, c) => sum + c.diff.additions, 0),
      deletions: proposal.changes.reduce((sum, c) => sum + c.diff.deletions, 0),
      warnings: proposalValidation.warnings,
      message: 'Code edit proposal created. Awaiting user approval.',
    };
  },
};

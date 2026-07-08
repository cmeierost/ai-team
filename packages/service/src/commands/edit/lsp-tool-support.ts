import path from 'node:path';
import type {
  ExecutionContext,
  IIdeAdapterFactory,
  LspProvider,
  LspResult,
  LspSymbol,
} from '@ai-team/core';

export class LspResolver {
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

export class LspPathService {
  constructor(private readonly workspaceRoot: string) {}

  toAbsolutePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(this.workspaceRoot, filePath);
  }
}

type LspFormatInput = Record<string, unknown>;

export class LspResultFormatter {
  static format(result: LspResult): Record<string, unknown> {
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

  static filterSymbolsByName(symbols: LspSymbol[], name: string): LspSymbol[] {
    const lower = name.toLowerCase();
    const matches: LspSymbol[] = [];
    for (const sym of symbols) {
      if (sym.name.toLowerCase().includes(lower)) matches.push(sym);
      if (sym.children?.length) {
        matches.push(...this.filterSymbolsByName(sym.children, name));
      }
    }
    return matches;
  }

  static formatForLlm(result: unknown): unknown {
    const r = result as LspFormatInput;
    const locs = r['locations'] as
      | Array<{ path: string; line: number; character: number; preview?: string }>
      | undefined;
    const syms = r['symbols'] as LspSymbol[] | undefined;
    const items = r['items'] as
      | Array<{ name: string; kind: string; path: string; line: number }>
      | undefined;
    const diags = r['diagnostics'] as
      | Array<{ path: string; line: number; severity: string; message: string }>
      | undefined;

    const opRaw = r['operation'];
    const opValue =
      typeof opRaw === 'string' ? opRaw : opRaw != null ? JSON.stringify(opRaw) : undefined;
    const op = opValue ? `operation: ${opValue}\n` : '';

    if (locs) {
      const lines = locs.map((l) => {
        const preview = l.preview ? ` — ${l.preview.trim()}` : '';
        return `${l.path}:${l.line}:${l.character}${preview}`;
      });
      return `${op}${locs.length} locations\n\n${lines.join('\n')}`;
    }

    if (syms) {
      return `${op}${syms.length} symbols\n\n${this.flattenSymbols(syms).join('\n')}`;
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

  private static flattenSymbols(symbols: LspSymbol[], indent = ''): string[] {
    const out: string[] = [];
    for (const symbol of symbols) {
      out.push(`${indent}${symbol.path}:${symbol.line} — ${symbol.name} (${symbol.kind})`);
      if (symbol.children?.length) {
        out.push(...this.flattenSymbols(symbol.children, `${indent}  `));
      }
    }
    return out;
  }
}

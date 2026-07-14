import path from 'node:path';
import { z } from 'zod';
import type { ExecutionContext, ITypeScriptAnalyzer } from '@ai-team/core';
import { ExecutionContextGuards } from './execution-context-guards.js';

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

  constructor(
    private readonly workspaceRoot: string,
    private readonly analyzer: ITypeScriptAnalyzer
  ) {}

  formatForLlm(result: unknown): unknown {
    const r = result as {
      filePath: string;
      functionName?: string;
      complexity?: {
        cyclomaticComplexity: number;
        linesOfCode: number;
        parameters: number;
        nestedDepth: number;
      };
      functions?: Array<{
        name: string;
        startLine: number;
        isAsync: boolean;
        isExported: boolean;
        complexity: {
          cyclomaticComplexity: number;
          linesOfCode: number;
          nestedDepth: number;
        };
      }>;
    };

    if (r.functionName && r.complexity) {
      const c = r.complexity;
      return `${r.filePath} — ${r.functionName}\ncyclo=${c.cyclomaticComplexity}  loc=${c.linesOfCode}  params=${c.parameters}  depth=${c.nestedDepth}`;
    }

    if (r.functions) {
      const lines = r.functions.map((f) => {
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
      : path.join(this.workspaceRoot, filePath);

    ExecutionContextGuards.requirePathPermissionChecker(context);

    if (functionName) {
      const complexity = await this.analyzer.calculateComplexity(absolutePath, functionName);
      return { filePath, functionName, complexity };
    }

    const functions = await this.analyzer.getFunctions(absolutePath);
    return { filePath, functions };
  }
}

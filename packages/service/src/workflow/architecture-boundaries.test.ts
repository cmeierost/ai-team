import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { globSync } from 'glob';

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromRegex = /\bfrom\s+['"]([^'"]+)['"]/g;
  const sideEffectRegex = /\bimport\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = fromRegex.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  while ((match = sideEffectRegex.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function readImports(root: string, relativePath: string): string[] {
  const content = readFileSync(path.join(root, relativePath), 'utf8');
  return collectImportSpecifiers(content);
}

describe('workflow architecture boundaries', () => {
  const repoRoot = path.resolve(process.cwd(), '..', '..');

  it('keeps service runtime free of infrastructure imports', () => {
    const files = globSync('packages/service/src/**/*.ts', {
      cwd: repoRoot,
      nodir: true,
      ignore: ['**/*.test.ts'],
    });

    const offenders = files.filter((file) =>
      readImports(repoRoot, file).some((specifier) => specifier === '@ai-team/infrastructure')
    );

    expect(offenders).toEqual([]);
  });

  it('keeps UI/API adapters free of workflow-actor implementation imports', () => {
    const files = globSync('packages/{cli,web,api-server,vscode}/src/**/*.{ts,tsx}', {
      cwd: repoRoot,
      nodir: true,
    });

    const forbiddenDirect = [
      '@ai-team/service/src/workflow/xstate-workflow-runner',
      '@ai-team/service/src/workflow/durable-chat-actor',
      '@ai-team/service/src/workflow/workflow-chat-compiler',
      '@ai-team/service/src/workflow/workflow-interaction-router',
    ];

    const forbiddenSymbolRegex =
      /\b(WorkflowRunner|WorkflowRunnerFactory|createDurableChatActor|compileWorkflowChatStep|WorkflowInteractionRouter)\b/;

    const offenders = files.filter((file) => {
      const content = readFileSync(path.join(repoRoot, file), 'utf8');
      const specifiers = collectImportSpecifiers(content);
      const hasForbiddenDirect = specifiers.some((specifier) =>
        forbiddenDirect.some((prefix) => specifier.startsWith(prefix))
      );
      const hasForbiddenServiceSymbol =
        specifiers.includes('@ai-team/service') &&
        forbiddenSymbolRegex.test(content);
      return hasForbiddenDirect || hasForbiddenServiceSymbol;
    });

    expect(offenders).toEqual([]);
  });
});

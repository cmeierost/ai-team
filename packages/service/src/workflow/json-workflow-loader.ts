/**
 * JSON Workflow Loader
 *
 * Scans `<workspaceRoot>/.ai-team/workflows/*.json` at startup,
 * validates each file against JsonWorkflowSchema, and returns
 * a list of JsonWorkflowTool instances ready to register in ToolManager.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonWorkflowSchema, JsonWorkflowTool } from './json-workflow-tool.js';
import type { IWorkflowRunnerFactory } from './runner.js';
import type { IQuestionService } from '../questions/question-service.js';

export async function loadJsonWorkflowTools(
  workspaceRoot: string,
  runnerFactory: IWorkflowRunnerFactory,
  questionService: IQuestionService
): Promise<JsonWorkflowTool[]> {
  const dir = join(workspaceRoot, '.ai-team', 'workflows');

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // Directory doesn't exist — no JSON workflows to load
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const tools: JsonWorkflowTool[] = [];

  for (const filename of jsonFiles) {
    const filePath = join(dir, filename);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      const result = JsonWorkflowSchema.safeParse(parsed);
      if (!result.success) {
        console.warn(
          `[json-workflow-loader] Skipping '${filename}': schema validation failed.\n` +
            result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
        );
        continue;
      }
      tools.push(new JsonWorkflowTool(result.data, runnerFactory, questionService));
    } catch (err) {
      console.warn(`[json-workflow-loader] Skipping '${filename}': ${String(err)}`);
    }
  }

  return tools;
}

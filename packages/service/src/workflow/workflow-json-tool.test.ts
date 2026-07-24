import { describe, expect, it } from 'vitest';
import { JsonWorkflowSchema } from './workflow-json-tool.js';

describe('JsonWorkflowSchema return command', () => {
  it('accepts a workflow-defined return command and arguments', () => {
    const parsed = JsonWorkflowSchema.parse({
      id: 'delegated-review',
      name: 'Delegated review',
      description: 'Review work that can return to its parent workflow.',
      return: {
        command: 'session-handoff-return',
        args: {
          includeOpenQuestions: true,
        },
      },
      steps: [],
    });

    expect(parsed.return).toEqual({
      command: 'session-handoff-return',
      args: {
        includeOpenQuestions: true,
      },
    });
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkflowStateStore } from './workflow-state.js';

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-service-workflow-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('WorkflowStateStore', () => {
  it('persists and reloads workflow answers for a command', async () => {
    const workspaceRoot = await createTempWorkspace();
    const store = new WorkflowStateStore(workspaceRoot);

    store.handleFrame('chat', {
      workflowId: 'wf-chat-1',
      stepId: 'step-1',
      continuationToken: 'token-1',
      question: {
        kind: 'input',
        message: 'Question?',
        workflow: {
          workflowId: 'wf-chat-1',
          questionId: 'q-1',
          continuationToken: 'token-1',
        },
      },
      result: 'answer-1',
    });

    const reloaded = new WorkflowStateStore(workspaceRoot);
    expect(reloaded.loadForCommand('chat')).toEqual({
      workflowId: 'wf-chat-1',
      continuationToken: 'token-1',
      answers: {
        'q-1': 'answer-1',
      },
    });
  });

  it('removes persisted state when workflow is completed', async () => {
    const workspaceRoot = await createTempWorkspace();
    const store = new WorkflowStateStore(workspaceRoot);

    store.handleFrame('init', {
      workflowId: 'wf-init-1',
      stepId: 'step-1',
      question: {
        kind: 'confirm',
        message: 'Continue?',
        workflow: {
          workflowId: 'wf-init-1',
          questionId: 'q-1',
        },
      },
      result: true,
    });

    store.handleFrame('init', {
      workflowId: 'wf-init-1',
      stepId: 'step-2',
      completed: true,
    });

    const reloaded = new WorkflowStateStore(workspaceRoot);
    expect(reloaded.loadForCommand('init')).toBeUndefined();
  });
});
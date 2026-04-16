import fs from 'node:fs';
import path from 'node:path';

import type {
  QuestionAnswerValue,
  WorkflowFrame,
  WorkflowStateSnapshot,
} from '@ai-team/api-client';

interface PersistedWorkflowState {
  version: 1;
  commandWorkflows: Record<string, string>;
  workflows: Record<string, WorkflowStateSnapshot>;
  updatedAt: string;
}

export class WorkflowStateStore {
  private readonly filePath: string;

  constructor(workspaceRoot: string) {
    this.filePath = path.join(workspaceRoot, '.ai-team', 'private', 'workflows', 'state.json');
  }

  loadForCommand(commandKey: string): WorkflowStateSnapshot | undefined {
    const state = this.readState();
    const workflowId = state.commandWorkflows[commandKey];
    if (!workflowId) {
      return undefined;
    }

    return state.workflows[workflowId];
  }

  handleFrame(commandKey: string, frame: WorkflowFrame): void {
    const workflowId = frame.workflowId || frame.question?.workflow?.workflowId;
    if (!workflowId) {
      return;
    }

    const state = this.readState();

    if (frame.completed || frame.error) {
      this.removeWorkflow(state, workflowId);
      this.writeState(state);
      return;
    }

    const snapshot = this.upsertWorkflow(state, workflowId);
    const continuationToken =
      frame.continuationToken || frame.question?.workflow?.continuationToken;
    if (continuationToken !== undefined) {
      snapshot.continuationToken = continuationToken;
    }

    const questionId = frame.question?.workflow?.questionId;
    if (questionId && frame.result !== undefined) {
      snapshot.answers[questionId] = frame.result as QuestionAnswerValue;
    }

    state.commandWorkflows[commandKey] = workflowId;
    this.writeState(state);
  }

  private upsertWorkflow(state: PersistedWorkflowState, workflowId: string): WorkflowStateSnapshot {
    const existing = state.workflows[workflowId];
    if (existing) {
      return existing;
    }

    const created: WorkflowStateSnapshot = {
      workflowId,
      answers: {},
    };
    state.workflows[workflowId] = created;
    return created;
  }

  private removeWorkflow(state: PersistedWorkflowState, workflowId: string): void {
    delete state.workflows[workflowId];
    for (const [key, linkedWorkflow] of Object.entries(state.commandWorkflows)) {
      if (linkedWorkflow === workflowId) {
        delete state.commandWorkflows[key];
      }
    }
  }

  private readState(): PersistedWorkflowState {
    if (!fs.existsSync(this.filePath)) {
      return {
        version: 1,
        commandWorkflows: {},
        workflows: {},
        updatedAt: new Date().toISOString(),
      };
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedWorkflowState>;
      return {
        version: 1,
        commandWorkflows: parsed.commandWorkflows || {},
        workflows: parsed.workflows || {},
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      };
    } catch {
      return {
        version: 1,
        commandWorkflows: {},
        workflows: {},
        updatedAt: new Date().toISOString(),
      };
    }
  }

  private writeState(state: PersistedWorkflowState): void {
    state.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  }
}

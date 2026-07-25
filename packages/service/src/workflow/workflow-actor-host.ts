import { createActor, toPromise, type AnyActorLogic, type InspectionEvent } from 'xstate';
import type { IWorkflowRunRepository, WorkflowRunRecord, WorkflowRunStatus } from '@ai-team/core';

export interface WorkflowActorHostStartOptions<TInput> {
  runId: string;
  definitionId: string;
  definitionVersion: string;
  actorLogic: AnyActorLogic;
  input: TInput;
  rootSessionId?: string;
  activeSessionId?: string;
  inspect?: (event: InspectionEvent) => void;
  onSnapshot?: (snapshot: unknown) => void;
}

export interface WorkflowActorRunHandle<TOutput> {
  readonly id: string;
  getStatus(): WorkflowRunStatus;
  getSnapshot(): unknown;
  getPersistedSnapshot(): unknown;
  checkpoint(): Promise<WorkflowRunRecord>;
  dispatch(event: unknown): Promise<void>;
  cancel(): Promise<void>;
  waitForDone(): Promise<TOutput>;
}

interface LiveRun<TOutput> {
  record: WorkflowRunRecord;
  actor: ReturnType<typeof createActor>;
  checkpointQueue: Promise<WorkflowRunRecord>;
  cancelled: boolean;
  done: Promise<TOutput>;
}

/**
 * Service-owned lifecycle host for durable root actors. It accepts only
 * serializable inputs/snapshots; definition compilation remains outside this
 * seam and XState stays out of core.
 */
export class WorkflowActorHost {
  constructor(private readonly repository: IWorkflowRunRepository) {}

  async start<TInput, TOutput>(
    options: WorkflowActorHostStartOptions<TInput>
  ): Promise<WorkflowActorRunHandle<TOutput>> {
    const record: WorkflowRunRecord = {
      id: options.runId,
      definitionId: options.definitionId,
      definitionVersion: options.definitionVersion,
      status: 'active',
      input: options.input,
      snapshot: null,
      snapshotSequence: 0,
      rootSessionId: options.rootSessionId,
      activeSessionId: options.activeSessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let requestInspectionCheckpoint: (() => void) | undefined;
    const actor = createActor(options.actorLogic, {
      input: options.input,
      inspect: (event) => {
        options.inspect?.(event);
        requestInspectionCheckpoint?.();
      },
    });
    return this.createHandle<TOutput>(record, actor, options.onSnapshot, (checkpoint) => {
      requestInspectionCheckpoint = checkpoint;
    });
  }

  async restore<TOutput>(
    options: Omit<WorkflowActorHostStartOptions<unknown>, 'input'>
  ): Promise<WorkflowActorRunHandle<TOutput>> {
    const record = await this.repository.get(options.runId);
    if (!record) {
      throw new Error(`Workflow run '${options.runId}' was not found.`);
    }
    if (record.definitionId !== options.definitionId || record.definitionVersion !== options.definitionVersion) {
      throw new Error(
        `Workflow run '${options.runId}' is incompatible with ${options.definitionId}@${options.definitionVersion}.`
      );
    }
    if (record.status !== 'active') {
      throw new Error(`Workflow run '${options.runId}' is ${record.status}, not active.`);
    }

    let requestInspectionCheckpoint: (() => void) | undefined;
    const actor = createActor(options.actorLogic, {
      snapshot: record.snapshot as any,
      inspect: (event) => {
        options.inspect?.(event);
        requestInspectionCheckpoint?.();
      },
    });
    return this.createHandle<TOutput>(record, actor, options.onSnapshot, (checkpoint) => {
      requestInspectionCheckpoint = checkpoint;
    });
  }

  private async createHandle<TOutput>(
    record: WorkflowRunRecord,
    actor: ReturnType<typeof createActor>,
    onSnapshot?: (snapshot: unknown) => void,
    registerInspectionCheckpoint?: (checkpoint: () => void) => void
  ): Promise<WorkflowActorRunHandle<TOutput>> {
    const live: LiveRun<TOutput> = {
      record,
      actor,
      checkpointQueue: Promise.resolve(record),
      cancelled: false,
      done: Promise.resolve(undefined as TOutput),
    };
    let inspectionCheckpointQueued = false;
    registerInspectionCheckpoint?.(() => {
      if (inspectionCheckpointQueued || live.record.status !== 'active') return;

      inspectionCheckpointQueued = true;
      queueMicrotask(() => {
        inspectionCheckpointQueued = false;
        if (live.record.status === 'active') {
          void this.enqueueCheckpoint(live);
        }
      });
    });
    actor.subscribe(() => {
      onSnapshot?.(actor.getSnapshot());
      if (actor.getSnapshot().status === 'active') {
        void this.enqueueCheckpoint(live);
      }
    });
    actor.start();
    await this.enqueueCheckpoint(live);
    live.done = toPromise(actor as any).then(async (output) => {
      if (!live.cancelled) {
        live.record.status = 'completed';
        live.record.output = output;
        live.record.completedAt = new Date().toISOString();
        await this.enqueueCheckpoint(live);
      }
      return output as TOutput;
    });

    return {
      id: record.id,
      getStatus: () => live.record.status,
      getSnapshot: () => actor.getSnapshot(),
      getPersistedSnapshot: () => actor.getPersistedSnapshot(),
      checkpoint: () => this.enqueueCheckpoint(live),
      dispatch: async (event) => {
        if (live.record.status !== 'active') {
          throw new Error(`Workflow run '${record.id}' is ${live.record.status}.`);
        }
        (actor as any).send(event);
        await this.enqueueCheckpoint(live);
      },
      cancel: async () => {
        if (live.record.status !== 'active') return;
        live.cancelled = true;
        actor.stop();
        live.record.status = 'cancelled';
        live.record.cancelledAt = new Date().toISOString();
        await this.enqueueCheckpoint(live);
      },
      waitForDone: () => live.done,
    };
  }

  private enqueueCheckpoint<TOutput>(live: LiveRun<TOutput>): Promise<WorkflowRunRecord> {
    live.checkpointQueue = live.checkpointQueue.then(async () => {
      live.record.snapshot = live.actor.getPersistedSnapshot();
      live.record.snapshotSequence += 1;
      live.record.updatedAt = new Date().toISOString();
      await this.repository.save(live.record);
      return live.record;
    });
    return live.checkpointQueue;
  }
}

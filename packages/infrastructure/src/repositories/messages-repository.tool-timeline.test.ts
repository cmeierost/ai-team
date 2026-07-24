import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteBackend } from '../storage/sqlite/sqlite-storage.js';
import * as dbSchema from '../storage/sqlite/schema.js';
import { MessagesRepository } from './messages-repository.js';

describe('MessagesRepository tool timeline', () => {
  const workspaces: string[] = [];
  const backends: SqliteBackend[] = [];

  afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.close()));
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, {
      recursive: true,
      force: true,
    })));
  });

  it('stores invocation input and completion output as separately timestamped records', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ai-team-tool-timeline-'));
    workspaces.push(workspace);
    const backend = new SqliteBackend(workspace);
    backends.push(backend);
    await backend.ensureReadyAsync();

    const now = '2026-07-24T12:23:07.437Z';
    backend.getDb().insert(dbSchema.sessions).values({
      id: 'session-1',
      developerId: 'clemens',
      startedAt: now,
      lastActivityAt: now,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    }).run();

    const repository = new MessagesRepository(backend.ensureReadyAsync, backend.getDb);
    await repository.insertToolCallRequest('session-1', {
      timestamp: now,
      from: 'emily-davis',
      content: '',
      tool_calls: [{
        callId: 'call-handoff-1',
        tool: 'com_handoff',
        params: { targetAgentId: 'sarah-lee' },
        requestedAt: now,
      }],
    });

    const completedAt = '2026-07-24T12:23:09.578Z';
    await repository.insertToolCallResult(
      'session-1',
      'call-handoff-1',
      { status: 'ok', message: 'Handoff requested.' },
      undefined,
      'result',
      completedAt
    );

    const [message] = await repository.getSessionMessages('session-1');
    expect(message.tool_calls?.[0]).toEqual(expect.objectContaining({
      callId: 'call-handoff-1',
      requestedAt: now,
      params: { targetAgentId: 'sarah-lee' },
      result: { status: 'ok', message: 'Handoff requested.' },
      resultPhase: 'result',
      completedAt,
    }));

    const callRow = backend.getDb().select().from(dbSchema.messageToolCalls).get();
    const resultRow = backend.getDb().select().from(dbSchema.messageToolResults).get();
    expect(callRow?.resultJson).toBeNull();
    expect(resultRow?.messageToolCallId).toBe(callRow?.id);
    expect(resultRow?.completedAt).toBe(completedAt);
  });

  it('round-trips typed chat error metadata while keeping it hidden from the LLM', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ai-team-chat-error-'));
    workspaces.push(workspace);
    const backend = new SqliteBackend(workspace);
    backends.push(backend);
    await backend.ensureReadyAsync();

    const now = '2026-07-24T17:33:39.826Z';
    backend.getDb().insert(dbSchema.sessions).values({
      id: 'session-error',
      developerId: 'clemens',
      startedAt: now,
      lastActivityAt: now,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    }).run();

    const repository = new MessagesRepository(backend.ensureReadyAsync, backend.getDb);
    await repository.insertMessage('session-error', {
      timestamp: now,
      from: 'sarah-lee',
      to: 'human',
      content: "step 'sendTurn' failed: boom",
      kind: 'error',
      hiddenFromLlm: true,
      failureId: 'chat-runtime-loop:run-123',
      errorCode: 'CHAT_WORKFLOW_FAILED',
      errorDetails: {
        workflowId: 'chat-runtime-loop',
        workflowInstanceId: 'chat-runtime-loop:run-123',
        stepId: 'sendTurn',
      },
    });
    await repository.insertMessage('session-error', {
      timestamp: now,
      from: 'sarah-lee',
      content: 'duplicate',
      kind: 'error',
      hiddenFromLlm: true,
      failureId: 'chat-runtime-loop:run-123',
    });

    const messages = await repository.getSessionMessages('session-error');
    expect(messages).toHaveLength(1);
    const [message] = messages;
    expect(message).toMatchObject({
      kind: 'error',
      hiddenFromLlm: true,
      failureId: 'chat-runtime-loop:run-123',
      errorCode: 'CHAT_WORKFLOW_FAILED',
      errorDetails: {
        workflowId: 'chat-runtime-loop',
        workflowInstanceId: 'chat-runtime-loop:run-123',
        stepId: 'sendTurn',
      },
    });
  });

  it('round-trips queryable LLM invocation metadata on assistant messages', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ai-team-llm-metrics-'));
    workspaces.push(workspace);
    const backend = new SqliteBackend(workspace);
    backends.push(backend);
    await backend.ensureReadyAsync();

    const now = '2026-07-24T20:00:00.000Z';
    backend.getDb().insert(dbSchema.sessions).values({
      id: 'session-metrics',
      developerId: 'clemens',
      startedAt: now,
      lastActivityAt: now,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    }).run();

    const repository = new MessagesRepository(backend.ensureReadyAsync, backend.getDb);
    await repository.insertMessage('session-metrics', {
      timestamp: now,
      from: 'michael-brown',
      to: 'human',
      content: 'Measured response',
      llmMetadata: {
        durationMs: 1250,
        timeToFirstTokenMs: 180,
        providerDurationMs: 990,
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        model: 'gpt-test',
        provider: 'openai',
      },
    });

    const [message] = await repository.getSessionMessages('session-metrics');
    expect(message.llmMetadata).toEqual({
      durationMs: 1250,
      timeToFirstTokenMs: 180,
      providerDurationMs: 990,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      model: 'gpt-test',
      provider: 'openai',
    });

    const row = backend.getDb().select().from(dbSchema.messages).get();
    expect(row).toMatchObject({
      llmDurationMs: 1250,
      llmPromptTokens: 120,
      llmTotalTokens: 150,
      llmModel: 'gpt-test',
      llmProvider: 'openai',
    });
  });
});

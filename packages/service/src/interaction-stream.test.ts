import { describe, expect, it } from 'vitest';

import { streamInteraction } from './interaction-stream.js';

describe('streamInteraction', () => {
  it('streams runtime events and completion markers through the shared helper', async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];

    for await (const event of streamInteraction({
      request: {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      invoke: async (_ctx, emitService) => {
        emitService.emit({ kind: 'token', text: 'shared hello' });
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    expect(events.map((event) => event.kind)).toEqual(['started', 'token', 'result', 'done']);
    expect(events[1]).toMatchObject({ kind: 'token', text: 'shared hello' });
  });

  it('normalizes invoke errors into error events', async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];

    for await (const event of streamInteraction({
      request: {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      invoke: async () => {
        throw new Error('boom');
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    expect(events.map((event) => event.kind)).toEqual(['started', 'error']);
    expect(events[1]).toMatchObject({ kind: 'error', message: 'boom' });
  });

  it('assigns monotonic toolEventSeq values to runtime tool events', async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];

    for await (const event of streamInteraction({
      request: {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      invoke: async (_ctx, emitService) => {
        emitService.emit({ kind: 'tool', toolName: 'fs_read', toolPhase: 'request' });
        emitService.emit({ kind: 'token', text: 'interleaved' });
        emitService.emit({ kind: 'tool', toolName: 'fs_read', toolPhase: 'start' });
        emitService.emit({ kind: 'tool', toolName: 'fs_read', toolPhase: 'result' });
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    const toolEvents = events.filter((event) => event.kind === 'tool');
    expect(toolEvents).toHaveLength(3);
    expect(toolEvents.map((event) => event.toolEventSeq)).toEqual([1, 2, 3]);
    expect(toolEvents.map((event) => event.toolPhase)).toEqual(['request', 'start', 'result']);
  });
});


describe('streamInteraction', () => {
  it('streams runtime events and completion markers through the shared helper', async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];

    for await (const event of streamInteraction({
      request: {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      invoke: async (context) => {
        context.emit?.({ kind: 'token', text: 'shared hello' });
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    expect(events.map((event) => event.kind)).toEqual(['started', 'token', 'result', 'done']);
    expect(events[1]).toMatchObject({ kind: 'token', text: 'shared hello' });
  });

  it('normalizes invoke errors into error events', async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];

    for await (const event of streamInteraction({
      request: {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      invoke: async () => {
        throw new Error('boom');
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    expect(events.map((event) => event.kind)).toEqual(['started', 'error']);
    expect(events[1]).toMatchObject({ kind: 'error', message: 'boom' });
  });

  it('assigns monotonic toolEventSeq values to runtime tool events', async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];

    for await (const event of streamInteraction({
      request: {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      invoke: async (context) => {
        context.emit?.({ kind: 'tool', toolName: 'fs_read', toolPhase: 'request' });
        context.emit?.({ kind: 'token', text: 'interleaved' });
        context.emit?.({ kind: 'tool', toolName: 'fs_read', toolPhase: 'start' });
        context.emit?.({ kind: 'tool', toolName: 'fs_read', toolPhase: 'result' });
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    const toolEvents = events.filter((event) => event.kind === 'tool');
    expect(toolEvents).toHaveLength(3);
    expect(toolEvents.map((event) => event.toolEventSeq)).toEqual([1, 2, 3]);
    expect(toolEvents.map((event) => event.toolPhase)).toEqual(['request', 'start', 'result']);
  });

  it('streams runtime events and completion markers through the shared helper', async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];

    for await (const event of streamInteraction({
      request: {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      invoke: async (context) => {
        context.emit?.({ kind: 'token', text: 'shared hello' });
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    expect(events.map((event) => event.kind)).toEqual(['started', 'token', 'result', 'done']);
    expect(events[1]).toMatchObject({ kind: 'token', text: 'shared hello' });
  });

  it('normalizes invoke errors into error events', async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];

    for await (const event of streamInteraction({
      request: {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      invoke: async () => {
        throw new Error('boom');
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    expect(events.map((event) => event.kind)).toEqual(['started', 'error']);
    expect(events[1]).toMatchObject({ kind: 'error', message: 'boom' });
  });
});

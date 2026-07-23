import { describe, expect, it } from 'vitest';
import { ChatRenderQueue } from './chatRenderQueue';

describe('ChatRenderQueue', () => {
  it('runs message mutations strictly in enqueue order', async () => {
    const queue = new ChatRenderQueue();
    const rendered: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let signalFirstStarted: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });

    const one = queue.enqueue(async () => {
      rendered.push('first:start');
      signalFirstStarted?.();
      await first;
      rendered.push('first:end');
    });
    const two = queue.enqueue(() => rendered.push('second'));

    await firstStarted;
    expect(rendered).toEqual(['first:start']);
    releaseFirst?.();
    await Promise.all([one, two]);
    expect(rendered).toEqual(['first:start', 'first:end', 'second']);
  });

  it('continues with later mutations when one fails', async () => {
    const queue = new ChatRenderQueue();
    const rendered: string[] = [];

    await expect(queue.enqueue(() => Promise.reject(new Error('failed')))).rejects.toThrow('failed');
    await queue.enqueue(() => rendered.push('next'));

    expect(rendered).toEqual(['next']);
  });
});

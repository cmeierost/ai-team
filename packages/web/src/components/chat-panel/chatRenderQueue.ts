/**
 * Serializes chat-list mutations. Stream events, session loads, and handoffs
 * all update the same list, so a later operation must not start rendering
 * until React has had a chance to commit the preceding one.
 */
export class ChatRenderQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(operation: () => void | Promise<void>): Promise<void> {
    const next = this.tail.catch(() => undefined).then(operation);
    this.tail = next;
    return next;
  }
}

export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

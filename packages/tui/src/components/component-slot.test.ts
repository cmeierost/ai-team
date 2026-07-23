import { describe, expect, it, vi } from 'vitest';
import type { Component } from '../component.js';
import { ComponentSlot } from './component-slot.js';

function focusable(label: string): Component & { focused: boolean } {
  return {
    focused: false,
    render: () => [label],
    handleInput: vi.fn(),
    invalidate: vi.fn(),
    remove: vi.fn(),
  };
}

describe('ComponentSlot', () => {
  it('routes focus, input, rendering, and restoration through nested components', () => {
    const base = focusable('base');
    const first = focusable('first');
    const second = focusable('second');
    const slot = new ComponentSlot(base);

    slot.focused = true;
    expect(base.focused).toBe(true);

    const restoreFirst = slot.push(first);
    const restoreSecond = slot.push(second);
    expect(base.focused).toBe(false);
    expect(first.focused).toBe(false);
    expect(second.focused).toBe(true);
    expect(slot.render(80)).toEqual(['second']);

    slot.handleInput('x');
    expect(second.handleInput).toHaveBeenCalledWith('x');

    restoreSecond();
    expect(first.focused).toBe(true);
    restoreFirst();
    expect(base.focused).toBe(true);
  });

  it('allows out-of-order cleanup without disturbing the active component', () => {
    const base = focusable('base');
    const first = focusable('first');
    const second = focusable('second');
    const slot = new ComponentSlot(base);
    slot.focused = true;

    const restoreFirst = slot.push(first);
    slot.push(second);
    restoreFirst();

    expect(slot.current).toBe(second);
    expect(second.focused).toBe(true);
    expect(slot.depth).toBe(2);
  });
});

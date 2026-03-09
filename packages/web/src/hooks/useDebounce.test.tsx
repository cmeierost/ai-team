import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { useDebounce } from './useDebounce';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebounce', () => {
  it('returns the initial value immediately and delays updates', () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: {
          value: 'initial',
          delay: 300,
        },
      },
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated', delay: 300 });

    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current).toBe('updated');
  });

  it('keeps only the latest value when updates happen faster than the delay', () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: {
          value: 'one',
          delay: 200,
        },
      },
    );

    rerender({ value: 'two', delay: 200 });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: 'three', delay: 200 });

    act(() => {
      vi.advanceTimersByTime(199);
    });

    expect(result.current).toBe('one');

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current).toBe('three');
  });
});
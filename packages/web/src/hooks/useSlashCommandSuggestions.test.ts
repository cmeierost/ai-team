import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockSlashCommands = vi.hoisted(() => [
  { key: 'help', usage: '/help', description: 'Show this help', llmCallable: false },
  { key: 'chat', usage: '/chat <name|role>', description: 'Switch to agent', llmCallable: false },
  { key: 'history', usage: '/history [n]', description: 'Show messages', llmCallable: false },
  {
    key: 'run',
    usage: '/run <command>',
    description: 'Run shell command',
    llmCallable: false,
    aliases: ['shell'],
  },
]);

vi.mock('../context/TeamContext', () => ({
  useTeam: () => ({
    client: {
      getSlashCommands: vi.fn(),
    },
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: mockSlashCommands })),
}));

import { useSlashCommandSuggestions } from './useSlashCommandSuggestions';

describe('useSlashCommandSuggestions', () => {
  it('is closed when input does not start with /', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('hello world'));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.suggestions).toHaveLength(0);
  });

  it('is closed for empty input', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions(''));
    expect(result.current.isOpen).toBe(false);
  });

  it('shows all commands for bare / input', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/'));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.suggestions).toHaveLength(4);
  });

  it('filters commands by prefix', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/h'));
    expect(result.current.suggestions.map(s => s.key)).toEqual(['help', 'history']);
  });

  it('filters to a single match', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/ch'));
    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].key).toBe('chat');
  });

  it('matches aliases', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/sh'));
    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].key).toBe('run');
  });

  it('is closed when no commands match', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/zzz'));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.suggestions).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/HE'));
    expect(result.current.suggestions.map(s => s.key)).toContain('help');
  });

  it('navigate(1) increments selectedIndex wrapping around', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/h'));
    // suggestions: help, history → length 2, default selectedIndex = -1
    act(() => result.current.navigate(1));
    expect(result.current.selectedIndex).toBe(0);
    act(() => result.current.navigate(1));
    expect(result.current.selectedIndex).toBe(1);
    act(() => result.current.navigate(1));
    expect(result.current.selectedIndex).toBe(0); // wraps
  });

  it('navigate(-1) decrements selectedIndex wrapping around', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/h'));
    act(() => result.current.navigate(-1));
    expect(result.current.selectedIndex).toBe(1); // wraps from -1 to last
  });

  it('select returns the usage string and closes the dropdown', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/ch'));
    let usage!: string;
    act(() => { usage = result.current.select(0); });
    expect(usage).toBe('/chat <name|role>');
    expect(result.current.isOpen).toBe(false);
  });

  it('dismiss closes the dropdown without changing input', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/h'));
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);
  });

  it('resets dismissed state when input changes to a new / fragment', () => {
    const { result, rerender } = renderHook(
      ({ input }: { input: string }) => useSlashCommandSuggestions(input),
      { initialProps: { input: '/h' } },
    );
    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);

    rerender({ input: '/c' });
    expect(result.current.isOpen).toBe(true);
  });
});

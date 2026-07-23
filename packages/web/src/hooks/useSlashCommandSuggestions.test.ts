import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';

const mockSlashCommands = vi.hoisted(() => [
  { key: 'help', group: 'system', aliases: ['help'], usage: '/system help', description: 'Show this help', llmCallable: false },
  { key: 'switch', group: 'session', aliases: ['switch'], usage: '/session switch', description: 'Switch to agent', llmCallable: false },
  { key: 'history', group: 'session', usage: '/session history', description: 'Show messages', llmCallable: false },
  {
    key: 'list',
    group: 'team',
    usage: '/team list',
    description: 'List team members',
    llmCallable: false,
  },
  {
    key: 'run',
    group: 'chat',
    usage: '/chat run',
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
    expect(result.current.suggestions).toHaveLength(5);
  });

  it('filters built-ins by group prefix', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/s'));
    expect(result.current.suggestions.map((s) => s.key)).toEqual(['help', 'history', 'run', 'switch']);
  });

  it('filters to a single grouped command', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/system h'));
    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].key).toBe('help');
  });

  it('matches aliases', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/sh'));
    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].key).toBe('run');
  });

  it('matches grouped command keys while typing slash command text', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/team li'));
    expect(result.current.suggestions.map((suggestion) => suggestion.key)).toContain('list');
  });

  it('is closed when no commands match', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/zzz'));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.suggestions).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/SYSTEM H'));
    expect(result.current.suggestions.map((s) => s.key)).toContain('help');
  });

  it('navigate(1) increments selectedIndex wrapping around', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/session'));
    // suggestions: history, switch → length 2, default selectedIndex = -1
    act(() => result.current.navigate(1));
    expect(result.current.selectedIndex).toBe(0);
    act(() => result.current.navigate(1));
    expect(result.current.selectedIndex).toBe(1);
    act(() => result.current.navigate(1));
    expect(result.current.selectedIndex).toBe(0); // wraps
  });

  it('navigate(-1) decrements selectedIndex wrapping around', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/session'));
    act(() => result.current.navigate(-1));
    expect(result.current.selectedIndex).toBe(1); // wraps from -1 to last
  });

  it('select returns canonical grouped invocation and closes the dropdown', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/system h'));
    let usage!: string;
    act(() => {
      usage = result.current.select(0);
    });
    expect(usage).toBe('/system help');
    expect(result.current.isOpen).toBe(false);
  });

  it('keeps filtering by grouped command tokens when typing arguments', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/system help extra'));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].key).toBe('help');
  });

  it('dismiss closes the dropdown without changing input', () => {
    const { result } = renderHook(() => useSlashCommandSuggestions('/s'));
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);
  });

  it('resets dismissed state when input changes to a new / fragment', () => {
    const { result, rerender } = renderHook(
      ({ input }: { input: string }) => useSlashCommandSuggestions(input),
      { initialProps: { input: '/session' } }
    );
    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);

    rerender({ input: '/system' });
    expect(result.current.isOpen).toBe(true);
  });

  it('orders built-in commands before dynamic skills for bare / input', () => {
    const skillEntry = {
      key: 'a-skill',
      usage: '/a-skill',
      description: 'Dynamic skill entry',
      aliases: [],
      availableIn: { chat: true },
      path: ['dynamic', 'skill'],
    };
    const commandEntry = {
      key: 'help',
      usage: '/help',
      description: 'Show this help',
      aliases: [],
      availableIn: { chat: true },
      path: ['chat'],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: [skillEntry, commandEntry],
    } as any);

    const { result } = renderHook(() => useSlashCommandSuggestions('/'));
    expect(result.current.suggestions[0]?.key).toBe('help');
    expect(result.current.suggestions[1]?.key).toBe('a-skill');
  });
});

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ChatCommandRegistryEntry } from '@ai-team/api-contracts';
import { useTeam } from '../context/TeamContext';

function isDynamicSkillCommand(cmd: Pick<ChatCommandRegistryEntry, 'path'>): boolean {
  return Array.isArray(cmd.path) && cmd.path[0] === 'dynamic' && cmd.path[1] === 'skill';
}

function commandSortRank(cmd: Pick<ChatCommandRegistryEntry, 'path'>): number {
  return isDynamicSkillCommand(cmd) ? 1 : 0;
}

function isDynamicCommand(cmd: Pick<ChatCommandRegistryEntry, 'path'>): boolean {
  return Array.isArray(cmd.path) && cmd.path[0] === 'dynamic';
}

export interface SlashCommandSuggestionsState {
  /** Filtered commands matching the current input fragment. Empty when not active. */
  suggestions: ChatCommandRegistryEntry[];
  /** Index of the currently highlighted suggestion, or -1 for none. */
  selectedIndex: number;
  /** Whether the suggestion dropdown should be shown. */
  isOpen: boolean;
  /** Highlight the next/previous item. delta must be 1 or -1. Wraps around. */
  navigate: (delta: 1 | -1) => void;
  /** Select a suggestion by index and return its canonical invocation string. */
  select: (index: number) => string;
  /** Close the dropdown without selecting. */
  dismiss: () => void;
}

/**
 * Detects a leading `/` in the chat input and returns filtered slash command suggestions.
 *
 * Active when `input` starts with `/` and contains no newline.
 * Filters by key or alias prefix-match (case-insensitive).
 */
export function useSlashCommandSuggestions(input: string): SlashCommandSuggestionsState {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const { client } = useTeam();

  const { data: registry = [] } = useQuery({
    queryKey: ['slashCommands'],
    queryFn: () => client.commands.list(),
    staleTime: Infinity,
  });

  const fragments = useMemo((): string[] | null => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/') || trimmed.includes('\n')) return null;
    return trimmed
      .slice(1)
      .trimStart()
      .split(/\s+/)
      .filter(Boolean)
      .map((fragment) => fragment.toLowerCase());
  }, [input]);

  const suggestions = useMemo((): ChatCommandRegistryEntry[] => {
    if (fragments === null) return [];
    const [groupFragment = '', keyFragment = ''] = fragments;
    return registry
      .filter((cmd) => {
        if (isDynamicCommand(cmd)) {
          return fragments.length <= 1 && cmd.key.toLowerCase().startsWith(groupFragment);
        }
        if (fragments.length > 1) {
          return (
            (cmd.group ?? '').toLowerCase().startsWith(groupFragment) &&
            cmd.key.toLowerCase().startsWith(keyFragment)
          );
        }
        return (
          (cmd.group ?? '').toLowerCase().startsWith(groupFragment) ||
          (cmd.aliases ?? []).some((alias) => alias.toLowerCase().startsWith(groupFragment))
        );
      })
      .sort((left, right) => {
        const leftRank = commandSortRank(left);
        const rightRank = commandSortRank(right);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.key.localeCompare(right.key);
      });
  }, [fragments, registry]);

  // Reset selection and dismissed state when suggestions change.
  useEffect(() => {
    setSelectedIndex(-1);
    setDismissed(false);
  }, [suggestions]);

  const isOpen = !dismissed && suggestions.length > 0;

  const navigate = (delta: 1 | -1) => {
    setSelectedIndex((prev) => {
      const count = suggestions.length;
      if (count === 0) return -1;
      if (prev === -1) return delta === 1 ? 0 : count - 1;
      return (prev + delta + count) % count;
    });
  };

  const select = (index: number): string => {
    const cmd = suggestions[index] ?? suggestions[0];
    setDismissed(true);
    return cmd?.usage ?? input;
  };

  const dismiss = () => setDismissed(true);

  return { suggestions, selectedIndex, isOpen, navigate, select, dismiss };
}

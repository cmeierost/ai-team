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

  const fragment = useMemo((): string | null => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/') || trimmed.includes('\n')) return null;
    const commandToken = trimmed.slice(1).split(/\s+/, 1)[0] ?? '';
    return commandToken.toLowerCase();
  }, [input]);

  const suggestions = useMemo((): ChatCommandRegistryEntry[] => {
    if (fragment === null) return [];
    return registry
      .filter((cmd) => {
        const usageToken = (cmd.usage ?? '')
          .trim()
          .replace(/^\//, '')
          .split(/\s+/, 1)[0]
          ?.toLowerCase();
        const keys = [cmd.key, ...(cmd.aliases ?? []), usageToken]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase());
        return keys.some((k) => k.startsWith(fragment));
      })
      .sort((left, right) => {
        const leftRank = commandSortRank(left);
        const rightRank = commandSortRank(right);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.key.localeCompare(right.key);
      });
  }, [fragment, registry]);

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
    return cmd ? `/${cmd.key}` : input;
  };

  const dismiss = () => setDismissed(true);

  return { suggestions, selectedIndex, isOpen, navigate, select, dismiss };
}

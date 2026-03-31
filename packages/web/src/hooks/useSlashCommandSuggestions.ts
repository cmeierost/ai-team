import { useMemo, useState, useEffect } from 'react';
import { IN_CHAT_COMMAND_REGISTRY, type ChatCommandRegistryEntry } from '@ai-team/api-client-http';

export interface SlashCommandSuggestionsState {
  /** Filtered commands matching the current input fragment. Empty when not active. */
  suggestions: ChatCommandRegistryEntry[];
  /** Index of the currently highlighted suggestion, or -1 for none. */
  selectedIndex: number;
  /** Whether the suggestion dropdown should be shown. */
  isOpen: boolean;
  /** Highlight the next/previous item. delta must be 1 or -1. Wraps around. */
  navigate: (delta: 1 | -1) => void;
  /** Select a suggestion by index and return its usage string. */
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

  const fragment = useMemo((): string | null => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/') || trimmed.includes('\n')) return null;
    return trimmed.slice(1).toLowerCase();
  }, [input]);

  const suggestions = useMemo((): ChatCommandRegistryEntry[] => {
    if (fragment === null) return [];
    return IN_CHAT_COMMAND_REGISTRY.filter(cmd => {
      const keys = [cmd.key, ...(cmd.aliases ?? [])];
      return keys.some(k => k.startsWith(fragment));
    });
  }, [fragment]);

  // Reset selection and dismissed state when suggestions change.
  useEffect(() => {
    setSelectedIndex(-1);
    setDismissed(false);
  }, [suggestions]);

  const isOpen = !dismissed && suggestions.length > 0;

  const navigate = (delta: 1 | -1) => {
    setSelectedIndex(prev => {
      const count = suggestions.length;
      if (count === 0) return -1;
      if (prev === -1) return delta === 1 ? 0 : count - 1;
      return (prev + delta + count) % count;
    });
  };

  const select = (index: number): string => {
    const cmd = suggestions[index] ?? suggestions[0];
    setDismissed(true);
    return cmd?.usage ?? (cmd ? `/${cmd.key}` : input);
  };

  const dismiss = () => setDismissed(true);

  return { suggestions, selectedIndex, isOpen, navigate, select, dismiss };
}

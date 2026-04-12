import type { ChatCommandRegistryEntry } from '@ai-team/api-client';
import './SlashCommandDropdown.css';

interface SlashCommandDropdownProps {
  suggestions: ChatCommandRegistryEntry[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function SlashCommandDropdown({
  suggestions,
  selectedIndex,
  onSelect,
}: Readonly<SlashCommandDropdownProps>) {
  if (suggestions.length === 0) return null;

  return (
    <ul className="slash-command-dropdown" role="listbox" aria-label="Slash command suggestions">
      {suggestions.map((cmd, i) => (
        <li
          key={cmd.key}
          className={`slash-command-item${i === selectedIndex ? ' slash-command-item--selected' : ''}`}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseDown={(e) => {
            // Prevent textarea blur before selection is applied
            e.preventDefault();
            onSelect(i);
          }}
        >
          <span className="slash-command-usage">{cmd.usage ?? `/${cmd.key}`}</span>
          <span className="slash-command-description">{cmd.description}</span>
        </li>
      ))}
    </ul>
  );
}

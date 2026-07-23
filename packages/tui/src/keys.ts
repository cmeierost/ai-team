/**
 * Key detection utilities for terminal input.
 */

/**
 * Check if a raw input string matches a key description.
 */
export function matchesKey(data: string, key: string): boolean {
  const parsed = parseKey(data);
  if (!parsed) return false;

  const target = key.toLowerCase();

  if (parsed.name === target) return true;

  if (parsed.ctrl && parsed.name) {
    if (`ctrl+${parsed.name}` === target) return true;
  }

  if (parsed.shift && parsed.name) {
    if (`shift+${parsed.name}` === target) return true;
  }

  return false;
}

/**
 * Parse raw terminal input into a key description.
 */
export interface ParsedKey {
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  code?: string;
}

export function parseKey(data: string): ParsedKey | null {
  if (!data) return null;

  const first = data.codePointAt(0);
  if (first === undefined) return null;

  // Ctrl+letter (0x01-0x1a)
  if (first >= 0x01 && first <= 0x1a) {
    return { name: String.fromCodePoint(first + 0x60), ctrl: true };
  }

  // Enter
  if (data === '\r') return { name: 'enter' };

  // Tab
  if (data === '\t') return { name: 'tab' };

  // Escape
  if (data === '\x1b') return { name: 'escape' };

  // Backspace / Delete
  if (data === '\x7f' || data === '\x08') return { name: 'backspace' };

  // CSI sequences
  if (first === 0x1b && data.length > 1 && data.codePointAt(1) === 0x5b) {
    return parseCsiSequence(data);
  }

  // Printable character
  if (first >= 0x20 && first < 0x7f) {
    return { name: data };
  }

  return null;
}

function parseCsiSequence(data: string): ParsedKey | null {
  if (data.length < 3) return null;

  const third = data.codePointAt(2);

  return parseSimpleArrow(third)
    || parseFunctionKeys(third)
    || parseTildeKeys(third, data)
    || parseCtrlArrow(data)
    || null;
}

function parseSimpleArrow(third: number | undefined): ParsedKey | null {
  if (third === 65) return { name: 'up' };
  if (third === 66) return { name: 'down' };
  if (third === 67) return { name: 'right' };
  if (third === 68) return { name: 'left' };
  return null;
}

function parseFunctionKeys(third: number | undefined): ParsedKey | null {
  if (third === 72) return { name: 'home' };
  if (third === 70) return { name: 'end' };
  return null;
}

function parseTildeKeys(third: number | undefined, data: string): ParsedKey | null {
  if (third === undefined) return null;

  const tilde = data.codePointAt(3);
  if (tilde !== 126) return null;

  if (third === 51) return { name: 'delete' };
  if (third === 50) return { name: 'insert' };
  if (third === 53) return { name: 'pageup' };
  if (third === 54) return { name: 'pagedown' };
  return null;
}

function parseCtrlArrow(data: string): ParsedKey | null {
  if (!data.startsWith('\x1b[1;5')) return null;

  const last = data.codePointAt(data.length - 1);
  if (last === 65) return { name: 'up', ctrl: true };
  if (last === 66) return { name: 'down', ctrl: true };
  if (last === 67) return { name: 'right', ctrl: true };
  if (last === 68) return { name: 'left', ctrl: true };
  return null;
}

/**
 * Decode a printable character from terminal input.
 */
export function decodePrintableKey(data: string): string | undefined {
  if (!data) return undefined;

  const first = data.codePointAt(0);
  if (first === undefined) return undefined;

  // Terminals may batch multiple printable characters into one stdin chunk,
  // and non-BMP characters occupy two UTF-16 code units.
  if (
    first >= 0x20
    && !data.startsWith('\x1b')
    && Array.from(data).every((char) => {
      const codePoint = char.codePointAt(0);
      return codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f;
    })
  ) {
    return data;
  }

  // Kitty CSI-u: ESC [ <codepoint> u
  if (first === 0x1b && data.length > 3 && data.codePointAt(1) === 0x5b) {
    const end = data.indexOf('u');
    if (end > 2) {
      const codepoint = Number.parseInt(data.slice(2, end), 10);
      if (!Number.isNaN(codepoint) && codepoint >= 32) {
        return String.fromCodePoint(codepoint);
      }
    }
  }

  return undefined;
}

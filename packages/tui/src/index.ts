/**
 * @ai-team/tui — Terminal UI framework with differential rendering.
 *
 * Inspired by pi-tui architecture, built for ai-team workflow engine.
 */

// Core
export { TUI } from './tui.js';
export { ProcessTerminal, type Terminal } from './terminal.js';
export { Container, type Component, type Focusable, CURSOR_MARKER, isFocusable } from './component.js';

// Input
export { LineEditor, BracketedPaste } from './input.js';
export { matchesKey, parseKey, decodePrintableKey, type ParsedKey } from './keys.js';

// Utils
export { visibleWidth, truncateToWidth, sliceByColumn } from './utils.js';

// Components
export { Text, type TextOptions } from './components/text.js';
export { Loader } from './components/loader.js';
export { Spacer } from './components/spacer.js';
export { Image, detectImageProtocol, type TerminalImageOptions } from './components/image.js';
export { Markdown, type MarkdownTheme } from './components/markdown.js';
export { ComponentSlot } from './components/component-slot.js';

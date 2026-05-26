export interface ResolvedTtsSpeechText {
  text: string;
  selected: boolean;
}

export interface ResolvedTtsSelectionRange {
  text: string;
  start: number;
  end: number;
}

interface SelectionLike {
  anchorNode: Node | null;
  focusNode: Node | null;
  isCollapsed: boolean;
  rangeCount: number;
  getRangeAt(index: number): Range;
  toString(): string;
}

interface ResolveTtsSpeechTextOptions {
  fallbackText: string;
  scopeElement: Element | null;
  selection: SelectionLike | null | undefined;
}

interface ResolveTtsSelectionRangeOptions {
  scopeElement: Element | null;
  selection: SelectionLike | null | undefined;
}

function isSelectionInsideScope(
  scopeElement: Element,
  selection: SelectionLike | null | undefined
): selection is SelectionLike {
  if (!selection || selection.isCollapsed || selection.rangeCount <= 0) {
    return false;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return false;
  }

  const { anchorNode, focusNode } = selection;
  return (
    (anchorNode ? scopeElement.contains(anchorNode) : false) ||
    (focusNode ? scopeElement.contains(focusNode) : false)
  );
}

export function resolveTtsSelectionRange({
  scopeElement,
  selection,
}: ResolveTtsSelectionRangeOptions): ResolvedTtsSelectionRange | null {
  if (!scopeElement || !isSelectionInsideScope(scopeElement, selection)) {
    return null;
  }

  const selectedText = selection.toString().trim();
  try {
    const selectedRange = selection.getRangeAt(0);
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(scopeElement);
    prefixRange.setEnd(selectedRange.startContainer, selectedRange.startOffset);
    const start = prefixRange.toString().length;
    const end = start + selectedText.length;
    if (end <= start) {
      return null;
    }

    return { text: selectedText, start, end };
  } catch {
    return null;
  }
}

export function resolveTtsSpeechText({
  fallbackText,
  scopeElement,
  selection,
}: ResolveTtsSpeechTextOptions): ResolvedTtsSpeechText {
  if (!scopeElement || !isSelectionInsideScope(scopeElement, selection)) {
    return { text: fallbackText, selected: false };
  }

  const scopedSelection = resolveTtsSelectionRange({ scopeElement, selection });
  if (!scopedSelection) {
    return { text: fallbackText, selected: false };
  }

  return { text: scopedSelection.text, selected: true };
}

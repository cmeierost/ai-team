import { describe, expect, it } from 'vitest';
import { resolveTtsSelectionRange, resolveTtsSpeechText } from './ttsSelection';

function createSelection(overrides: Partial<Selection> & { text?: string }): Selection {
  const text = overrides.text ?? '';
  const defaultRange = document.createRange();
  return {
    anchorNode: overrides.anchorNode ?? null,
    focusNode: overrides.focusNode ?? null,
    isCollapsed: overrides.isCollapsed ?? true,
    rangeCount: overrides.rangeCount ?? 0,
    getRangeAt: overrides.getRangeAt ?? (() => defaultRange),
    toString: () => text,
  } as Selection;
}

describe('resolveTtsSpeechText', () => {
  it('returns fallback text when nothing is selected', () => {
    const scope = document.createElement('div');

    const result = resolveTtsSpeechText({
      fallbackText: 'Read full bubble',
      scopeElement: scope,
      selection: createSelection({ isCollapsed: true, rangeCount: 0 }),
    });

    expect(result).toEqual({ text: 'Read full bubble', selected: false });
  });

  it('returns selected text when selection is inside the bubble scope', () => {
    const scope = document.createElement('div');
    const textNode = document.createTextNode('const total = amount * taxRate;');
    scope.appendChild(textNode);

    const result = resolveTtsSpeechText({
      fallbackText: 'Read full bubble',
      scopeElement: scope,
      selection: createSelection({
        anchorNode: textNode,
        focusNode: textNode,
        isCollapsed: false,
        rangeCount: 1,
        text: 'amount * taxRate',
      }),
    });

    expect(result).toEqual({ text: 'amount * taxRate', selected: true });
  });

  it('falls back when selection is outside the bubble scope', () => {
    const scope = document.createElement('div');
    const outside = document.createElement('div');
    const outsideText = document.createTextNode('outside text');
    outside.appendChild(outsideText);

    const result = resolveTtsSpeechText({
      fallbackText: 'Read full bubble',
      scopeElement: scope,
      selection: createSelection({
        anchorNode: outsideText,
        focusNode: outsideText,
        isCollapsed: false,
        rangeCount: 1,
        text: 'outside text',
      }),
    });

    expect(result).toEqual({ text: 'Read full bubble', selected: false });
  });

  it('returns scoped selection offsets when selection is inside scope', () => {
    const scope = document.createElement('div');
    const textNode = document.createTextNode('alpha beta gamma delta');
    scope.appendChild(textNode);

    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 10);

    const result = resolveTtsSelectionRange({
      scopeElement: scope,
      selection: createSelection({
        anchorNode: textNode,
        focusNode: textNode,
        isCollapsed: false,
        rangeCount: 1,
        text: 'beta',
        getRangeAt: () => range,
      }),
    });

    expect(result).toEqual({ text: 'beta', start: 6, end: 10 });
  });

  it('returns null for scoped selection offsets when selection is outside scope', () => {
    const scope = document.createElement('div');
    const outside = document.createElement('div');
    const outsideText = document.createTextNode('outside text');
    outside.appendChild(outsideText);

    const range = document.createRange();
    range.selectNodeContents(outsideText);

    const result = resolveTtsSelectionRange({
      scopeElement: scope,
      selection: createSelection({
        anchorNode: outsideText,
        focusNode: outsideText,
        isCollapsed: false,
        rangeCount: 1,
        text: 'outside text',
        getRangeAt: () => range,
      }),
    });

    expect(result).toBeNull();
  });
});

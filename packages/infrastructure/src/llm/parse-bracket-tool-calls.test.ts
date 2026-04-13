import { describe, expect, it } from 'vitest';
import { parseBracketToolCalls } from './index.js';

describe('parseBracketToolCalls', () => {
  it('parses [tool:name] JSON blocks for known tools', () => {
    const parsed = parseBracketToolCalls(
      `[tool:com_ask]\n{\n  "kind": "select",\n  "message": "pick",\n  "choices": [{"name":"A","value":"a"}]\n}`,
      new Set(['com_ask'])
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.toolName).toBe('com_ask');
    expect(parsed[0]?.args).toEqual({
      kind: 'select',
      message: 'pick',
      choices: [{ name: 'A', value: 'a' }],
    });
  });

  it('ignores unknown tools and invalid JSON payloads', () => {
    const parsed = parseBracketToolCalls(
      `[tool:unknown]\n{}\n\n[tool:com_ask]\nnot-json`,
      new Set(['com_ask'])
    );

    expect(parsed).toHaveLength(0);
  });

  it('supports fenced json payloads', () => {
    const parsed = parseBracketToolCalls(
      `[tool:com_ask]\n\n\`\`\`json\n{\n  "kind": "input",\n  "message": "hello"\n}\n\`\`\``,
      new Set(['com_ask'])
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.args).toEqual({ kind: 'input', message: 'hello' });
  });
});

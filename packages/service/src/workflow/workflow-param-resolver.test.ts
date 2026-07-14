import { describe, expect, it } from 'vitest';

import {
  evaluateWorkflowCondition,
  resolveTemplateData,
  resolveTemplateExpressions,
} from './workflow-param-resolver.js';

describe('workflow param resolver (json-mode)', () => {
  it('resolves classic template expressions', () => {
    const resolved = resolveTemplateExpressions(
      {
        role: 'CEO',
        count: '5',
        picked: '{{pick_ceo.answer}}',
      },
      {
        pick_ceo: { answer: 'Michael Brown' },
      }
    );

    expect(resolved).toEqual({
      role: 'CEO',
      count: 5,
      picked: 'Michael Brown',
    });
  });

  it('supports $map transform for array-to-object mapping', () => {
    const resolved = resolveTemplateData(
      {
        choices: {
          $map: {
            from: '{{ceo_names.suggestions}}',
            as: 'candidate',
            value: {
              name: '{{candidate}}',
              value: '{{candidate}}',
            },
          },
        },
      },
      {
        ceo_names: { suggestions: ['Alice Smith', 'Bob Johnson'] },
      }
    );

    expect(resolved).toEqual({
      choices: [
        { name: 'Alice Smith', value: 'Alice Smith' },
        { name: 'Bob Johnson', value: 'Bob Johnson' },
      ],
    });
  });

  it('supports $coalesce transform', () => {
    const resolved = resolveTemplateData(
      {
        messages: { $coalesce: ['{{hire_session.messages}}', []] },
      },
      {
        hire_session: {},
      }
    );

    expect(resolved).toEqual({ messages: [] });
  });

  it('evaluates declarative condition expressions', () => {
    const state = {
      hire_choice: { answer: 'hire' },
      count: 1,
      enabled: true,
    };

    expect(evaluateWorkflowCondition('{{hire_choice.answer}} == "hire"', state)).toBe(true);
    expect(evaluateWorkflowCondition('{{hire_choice.answer}} != "skip"', state)).toBe(true);
    expect(evaluateWorkflowCondition('{{count}} === 1', state)).toBe(true);
    expect(evaluateWorkflowCondition('{{enabled}}', state)).toBe(true);
    expect(evaluateWorkflowCondition('{{enabled}} === false', state)).toBe(false);
  });
});

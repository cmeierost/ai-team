import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { registerRenderer } from './registry';

function formatAnswer(answer: unknown): string {
  if (answer === undefined || answer === null) return 'No answer captured';
  if (Array.isArray(answer)) return answer.length ? answer.map(String).join(', ') : 'No selection';
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number' || typeof answer === 'bigint') return String(answer);
  try { return JSON.stringify(answer); } catch { return 'Complex value'; }
}

registerRenderer({
  toolName: 'com_ask',
  render(result: unknown, _resultLlm: unknown, _event: SessionActivatedTool): ReactNode {
    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    const req = r.request && typeof r.request === 'object' ? r.request as Record<string, unknown> : undefined;
    const res = r.response && typeof r.response === 'object' ? r.response as Record<string, unknown> : undefined;
    const errorMsg = typeof r.error === 'string' ? r.error : undefined;

    const question = (req?.question ?? res?.question) as string | undefined;
    const questionType = (req?.questionType ?? res?.questionType) as string | undefined;
    const choicesCount = Array.isArray(req?.choices) ? req.choices.length : 0;

    return (
      <div className="tc-com-ask">
        {question && <div className="tc-com-question">{question}</div>}
        {questionType && (
          <div className="tc-meta">
            type: {questionType}{choicesCount > 0 ? ` · ${choicesCount} choices` : ''}
          </div>
        )}
        {errorMsg ? (
          <div className="tc-error-text">{errorMsg}</div>
        ) : res?.answer !== undefined ? (
          <div className="tc-com-answer">
            <span className="tc-meta-label">Answer:</span> {formatAnswer(res.answer)}
          </div>
        ) : null}
      </div>
    );
  },
});

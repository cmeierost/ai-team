import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import type { PendingQuestion, QuestionChoice } from '../chatPanelTypes';
import { registerRenderer } from './registry';

type Dict = Record<string, unknown>;

function isRecord(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asQuestionChoices(value: unknown): QuestionChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Dict => isRecord(entry))
    .map((entry) => {
      const optionValue = asString(entry.value) ?? asString(entry.name) ?? '';
      const optionName = asString(entry.name) ?? optionValue;
      return { name: optionName, value: optionValue };
    })
    .filter((choice) => choice.value.length > 0);
}

function normalizeQuestionKind(value: unknown): PendingQuestion['kind'] {
  const kind = asString(value);
  switch (kind) {
    case 'confirm':
    case 'select':
    case 'password':
    case 'checklist':
    case 'form':
      return kind;
    default:
      return 'input';
  }
}

function getComAskPayload(
  result: unknown,
  event: SessionActivatedTool
): {
  request: Dict;
  answer: unknown;
  error?: string;
} {
  const resultRecord = isRecord(result) ? result : {};
  const requestFromResult = isRecord(resultRecord.request) ? resultRecord.request : undefined;
  const requestFromEvent = isRecord(event.toolResult?.request)
    ? event.toolResult.request
    : undefined;
  const request = requestFromResult ?? requestFromEvent ?? resultRecord;

  const responseFromResult = isRecord(resultRecord.response) ? resultRecord.response : undefined;
  const answer = responseFromResult?.answer ?? resultRecord.answer;
  const error = asString(resultRecord.error);

  return {
    request,
    answer,
    error,
  };
}

function toPendingQuestion(request: Dict): PendingQuestion | null {
  const kind = normalizeQuestionKind(request.kind ?? request.questionType);
  const message = asString(request.message ?? request.question) ?? 'Question';

  if (kind === 'confirm') {
    return {
      kind: 'confirm',
      message,
      defaultValue: asBoolean(request.default) ?? false,
      style: asString(request.style) === 'allow' ? 'allow' : 'confirm',
    };
  }

  if (kind === 'select' || kind === 'checklist') {
    const choices = asQuestionChoices(request.choices);
    if (choices.length === 0) {
      return {
        kind: 'input',
        message,
      };
    }
    return {
      kind,
      message,
      choices,
      allowOther: asBoolean(request.allowOther),
      otherLabel: asString(request.otherLabel),
      otherPrompt: asString(request.otherPrompt),
    };
  }

  if (kind === 'form') {
    const fields = Array.isArray(request.fields)
      ? request.fields
          .filter((entry): entry is Dict => isRecord(entry))
          .map((field, index) => ({
            id: asString(field.id) ?? `field-${index + 1}`,
            label: asString(field.label) ?? asString(field.id) ?? `Field ${index + 1}`,
            placeholder: asString(field.placeholder),
            required: asBoolean(field.required),
            multiline: asBoolean(field.multiline),
            default: asString(field.default),
          }))
      : [];

    if (fields.length === 0) {
      return {
        kind: 'input',
        message,
      };
    }

    return {
      kind: 'form',
      message,
      fields,
    };
  }

  return {
    kind,
    message,
  };
}

function toTextValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function toConfirmAnswer(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = asString(value)?.toLowerCase();
  return normalized === 'true' || normalized === 'yes';
}

function toChecklistAnswer(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

function toFormAnswer(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue === 'string')
      .map(([key, entryValue]) => [key, entryValue as string])
  );
}

function buildReadOnlyAnswers(
  pendingQuestion: PendingQuestion,
  answer: unknown
): {
  pendingInputAnswer: string;
  pendingPasswordAnswer: string;
  pendingConfirmAnswer: boolean;
  pendingSelectAnswer: string;
  pendingChecklistAnswer: string[];
  pendingFormAnswer: Record<string, string>;
} {
  const defaults = {
    pendingInputAnswer: '',
    pendingPasswordAnswer: '',
    pendingConfirmAnswer: false,
    pendingSelectAnswer: '',
    pendingChecklistAnswer: [] as string[],
    pendingFormAnswer: {} as Record<string, string>,
  };

  switch (pendingQuestion.kind) {
    case 'input':
      return { ...defaults, pendingInputAnswer: toTextValue(answer) };
    case 'password':
      return { ...defaults, pendingPasswordAnswer: toTextValue(answer) };
    case 'confirm':
      return { ...defaults, pendingConfirmAnswer: toConfirmAnswer(answer) };
    case 'select': {
      const selected = toTextValue(answer) || pendingQuestion.choices[0]?.value || '';
      return { ...defaults, pendingSelectAnswer: selected };
    }
    case 'checklist':
      return { ...defaults, pendingChecklistAnswer: toChecklistAnswer(answer) };
    case 'form':
      return { ...defaults, pendingFormAnswer: toFormAnswer(answer) };
    default:
      return defaults;
  }
}

function ReadOnlyAskForm({
  pendingQuestion,
  pendingInputAnswer,
  pendingPasswordAnswer,
  pendingConfirmAnswer,
  pendingSelectAnswer,
  pendingChecklistAnswer,
  pendingFormAnswer,
}: Readonly<{
  pendingQuestion: PendingQuestion;
  pendingInputAnswer: string;
  pendingPasswordAnswer: string;
  pendingConfirmAnswer: boolean;
  pendingSelectAnswer: string;
  pendingChecklistAnswer: string[];
  pendingFormAnswer: Record<string, string>;
}>): ReactNode {
  return (
    <div className="chat-input-container pending-question-form">
      <div className="pending-question-title">{pendingQuestion.message}</div>

      {pendingQuestion.kind === 'input' ? (
        <input
          type="text"
          className="pending-question-control pending-question-input"
          value={pendingInputAnswer}
          placeholder="Enter your answer"
          title="Answer"
          readOnly
          disabled
        />
      ) : null}

      {pendingQuestion.kind === 'password' ? (
        <input
          type="password"
          className="pending-question-control pending-question-input"
          value={pendingPasswordAnswer}
          placeholder="Enter your answer"
          title="Answer"
          readOnly
          disabled
        />
      ) : null}

      {pendingQuestion.kind === 'confirm' ? (
        <div className="pending-question-confirm">
          <button
            type="button"
            className="confirm-answer-button confirm-answer-yes"
            disabled
            aria-pressed={pendingConfirmAnswer}
          >
            {pendingQuestion.style === 'allow' ? 'Allow' : 'Yes'}
          </button>
          <button
            type="button"
            className="confirm-answer-button confirm-answer-no"
            disabled
            aria-pressed={!pendingConfirmAnswer}
          >
            {pendingQuestion.style === 'allow' ? 'Deny' : 'No'}
          </button>
        </div>
      ) : null}

      {pendingQuestion.kind === 'select' ? (
        <>
          <select
            className="pending-question-control pending-question-select"
            value={pendingSelectAnswer}
            title="Chosen option"
            disabled
          >
            {pendingQuestion.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.name}
              </option>
            ))}
          </select>
          {pendingQuestion.allowOther ? (
            <small className="pending-question-hint">
              You can choose “{pendingQuestion.otherLabel || 'Other (type your own)'}” for free
              text.
            </small>
          ) : null}
        </>
      ) : null}

      {pendingQuestion.kind === 'checklist' ? (
        <>
          <div className="pending-question-control pending-question-checklist">
            {pendingQuestion.choices.map((choice) => (
              <label key={choice.value} className="pending-question-checklist-item">
                <input
                  type="checkbox"
                  checked={pendingChecklistAnswer.includes(choice.value)}
                  disabled
                />
                {choice.name}
              </label>
            ))}
          </div>
          {pendingQuestion.allowOther ? (
            <small className="pending-question-hint">
              Multi-select enabled. Choose “{pendingQuestion.otherLabel || 'Other (type your own)'}”
              to add custom text.
            </small>
          ) : null}
        </>
      ) : null}

      {pendingQuestion.kind === 'form' ? (
        <div className="pending-question-control pending-question-form-fields">
          {pendingQuestion.fields.map((field) => (
            <label key={field.id} className="pending-question-form-field">
              <span className="pending-question-form-label">
                {field.label}
                {field.required ? ' *' : ''}
              </span>
              {field.multiline ? (
                <textarea
                  className="pending-question-control pending-question-input"
                  value={pendingFormAnswer[field.id] ?? ''}
                  placeholder={field.placeholder || ''}
                  rows={3}
                  readOnly
                  disabled
                />
              ) : (
                <input
                  type="text"
                  className="pending-question-control pending-question-input"
                  value={pendingFormAnswer[field.id] ?? ''}
                  placeholder={field.placeholder || ''}
                  readOnly
                  disabled
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

registerRenderer({
  toolName: 'com_ask',
  render(result: unknown, _resultLlm: unknown, event: SessionActivatedTool): ReactNode {
    const { request, answer, error } = getComAskPayload(result, event);
    const pendingQuestion = toPendingQuestion(request);
    if (!pendingQuestion) {
      return null;
    }

    const {
      pendingInputAnswer,
      pendingPasswordAnswer,
      pendingConfirmAnswer,
      pendingSelectAnswer,
      pendingChecklistAnswer,
      pendingFormAnswer,
    } = buildReadOnlyAnswers(pendingQuestion, answer);

    return (
      <div className="tc-com-ask">
        <ReadOnlyAskForm
          pendingQuestion={pendingQuestion}
          pendingInputAnswer={pendingInputAnswer}
          pendingPasswordAnswer={pendingPasswordAnswer}
          pendingConfirmAnswer={pendingConfirmAnswer}
          pendingSelectAnswer={pendingSelectAnswer}
          pendingChecklistAnswer={pendingChecklistAnswer}
          pendingFormAnswer={pendingFormAnswer}
        />
        {error ? <div className="tc-error-text">{error}</div> : null}
      </div>
    );
  },
});

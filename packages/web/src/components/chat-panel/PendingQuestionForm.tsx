import type { PendingQuestion } from './chatPanelTypes';

interface PendingQuestionFormProps {
  pendingQuestion: PendingQuestion;
  pendingInputAnswer: string;
  pendingPasswordAnswer: string;
  pendingConfirmAnswer: boolean;
  pendingSelectAnswer: string;
  pendingChecklistAnswer: string[];
  pendingFormAnswer: Record<string, string>;
  onPendingInputAnswerChange: (value: string) => void;
  onPendingPasswordAnswerChange: (value: string) => void;
  onPendingConfirmAnswerChange: (value: boolean) => void;
  onPendingSelectAnswerChange: (value: string) => void;
  onTogglePendingChecklistValue: (choiceValue: string, checked: boolean) => void;
  onPendingFormFieldChange: (fieldId: string, value: string) => void;
  onSubmit: (event: { preventDefault(): void }) => void;
}

export function PendingQuestionForm({ pendingQuestion, pendingInputAnswer, pendingPasswordAnswer, pendingConfirmAnswer, pendingSelectAnswer, pendingChecklistAnswer, pendingFormAnswer, onPendingInputAnswerChange, onPendingPasswordAnswerChange, onPendingConfirmAnswerChange, onPendingSelectAnswerChange, onTogglePendingChecklistValue, onPendingFormFieldChange, onSubmit }: Readonly<PendingQuestionFormProps>) {
  return (
    <form className="chat-input-container pending-question-form" onSubmit={onSubmit}>
      <div className="pending-question-title">{pendingQuestion.message}</div>

      {pendingQuestion.kind === 'input' ? (
        <input
          type="text"
          className="pending-question-control pending-question-input"
          value={pendingInputAnswer}
          onChange={(event) => onPendingInputAnswerChange(event.target.value)}
          placeholder="Enter your answer"
          title="Answer"
        />
      ) : null}

      {pendingQuestion.kind === 'password' ? (
        <input
          type="password"
          className="pending-question-control pending-question-input"
          value={pendingPasswordAnswer}
          onChange={(event) => onPendingPasswordAnswerChange(event.target.value)}
          placeholder="Enter your answer"
          title="Answer"
        />
      ) : null}

      {pendingQuestion.kind === 'confirm' ? (
        <label className="pending-question-control pending-question-confirm">
          <input
            type="checkbox"
            checked={pendingConfirmAnswer}
            onChange={(event) => onPendingConfirmAnswerChange(event.target.checked)}
          />
          <span>Yes / No</span>
        </label>
      ) : null}

      {pendingQuestion.kind === 'select' ? (
        <>
          <select
            className="pending-question-control pending-question-select"
            value={pendingSelectAnswer}
            onChange={(event) => onPendingSelectAnswerChange(event.target.value)}
            title="Choose one option"
          >
            {pendingQuestion.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.name}
              </option>
            ))}
          </select>
          {pendingQuestion.allowOther ? (
            <small className="pending-question-hint">
              You can choose “{pendingQuestion.otherLabel || 'Other (type your own)'}” for free text.
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
                  onChange={(event) => onTogglePendingChecklistValue(choice.value, event.target.checked)}
                />
                {choice.name}
              </label>
            ))}
          </div>
          {pendingQuestion.allowOther ? (
            <small className="pending-question-hint">
              Multi-select enabled. Choose “{pendingQuestion.otherLabel || 'Other (type your own)'}” to add custom text.
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
                  onChange={(event) => onPendingFormFieldChange(field.id, event.target.value)}
                  placeholder={field.placeholder || ''}
                  rows={3}
                  required={field.required}
                  title={field.label}
                />
              ) : (
                <input
                  type="text"
                  className="pending-question-control pending-question-input"
                  value={pendingFormAnswer[field.id] ?? ''}
                  onChange={(event) => onPendingFormFieldChange(field.id, event.target.value)}
                  placeholder={field.placeholder || ''}
                  required={field.required}
                  title={field.label}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}

      <div className="chat-input-actions">
        <button type="submit" className="chat-action-button chat-send-button pending-question-submit">
          Send answers
        </button>
      </div>
    </form>
  );
}

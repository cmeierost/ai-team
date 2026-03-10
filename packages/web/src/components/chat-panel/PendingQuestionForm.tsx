import type { PendingQuestion } from './chatPanelTypes';

interface PendingQuestionFormProps {
  pendingQuestion: PendingQuestion;
  pendingInputAnswer: string;
  pendingPasswordAnswer: string;
  pendingConfirmAnswer: boolean;
  pendingSelectAnswer: string;
  pendingChecklistAnswer: string[];
  onPendingInputAnswerChange: (value: string) => void;
  onPendingPasswordAnswerChange: (value: string) => void;
  onPendingConfirmAnswerChange: (value: boolean) => void;
  onPendingSelectAnswerChange: (value: string) => void;
  onTogglePendingChecklistValue: (choiceValue: string, checked: boolean) => void;
  onSubmit: (event: { preventDefault(): void }) => void;
}

export function PendingQuestionForm({ pendingQuestion, pendingInputAnswer, pendingPasswordAnswer, pendingConfirmAnswer, pendingSelectAnswer, pendingChecklistAnswer, onPendingInputAnswerChange, onPendingPasswordAnswerChange, onPendingConfirmAnswerChange, onPendingSelectAnswerChange, onTogglePendingChecklistValue, onSubmit }: Readonly<PendingQuestionFormProps>) {
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
          <span>Confirm</span>
        </label>
      ) : null}

      {pendingQuestion.kind === 'select' ? (
        <select
          className="pending-question-control pending-question-select"
          value={pendingSelectAnswer}
          onChange={(event) => onPendingSelectAnswerChange(event.target.value)}
          title="Choose an option"
        >
          {pendingQuestion.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.name}
            </option>
          ))}
        </select>
      ) : null}

      {pendingQuestion.kind === 'checklist' ? (
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
      ) : null}

      <div className="chat-input-actions">
        <button type="submit" className="chat-action-button chat-send-button pending-question-submit">
          Send answers
        </button>
      </div>
    </form>
  );
}

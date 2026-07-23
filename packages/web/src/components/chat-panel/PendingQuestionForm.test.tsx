import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PendingQuestionForm } from './PendingQuestionForm';

describe('PendingQuestionForm', () => {
  it('renders delegation approval as allow/deny and preserves a denied boolean answer', () => {
    const onConfirmDirectAnswer = vi.fn();

    render(
      <PendingQuestionForm
        pendingQuestion={{
          kind: 'confirm',
          message: 'Allow this handoff?',
          defaultValue: false,
          style: 'allow',
        }}
        pendingInputAnswer=""
        pendingPasswordAnswer=""
        pendingSelectAnswer=""
        pendingChecklistAnswer={[]}
        pendingFormAnswer={{}}
        onPendingInputAnswerChange={vi.fn()}
        onPendingPasswordAnswerChange={vi.fn()}
        onPendingSelectAnswerChange={vi.fn()}
        onTogglePendingChecklistValue={vi.fn()}
        onPendingFormFieldChange={vi.fn()}
        onConfirmDirectAnswer={onConfirmDirectAnswer}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText('Allow this handoff?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onConfirmDirectAnswer).toHaveBeenCalledWith(false);
  });
});

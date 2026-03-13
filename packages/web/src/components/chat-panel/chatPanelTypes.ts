import type { CSSProperties } from 'react';
import type { Agent, ChatMessage, SessionActivatedTool } from '../../types';

export interface QuestionChoice {
  name: string;
  value: string;
}

export interface InputQuestionRequest {
  message: string;
}

export interface ConfirmQuestionRequest {
  message: string;
  default?: boolean;
}

export interface SelectQuestionRequest {
  message: string;
  choices: QuestionChoice[];
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
}

export interface PasswordQuestionRequest {
  message: string;
}

export interface ChecklistQuestionRequest {
  message: string;
  choices: QuestionChoice[];
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
}

export interface FormQuestionField {
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  default?: string;
}

export interface FormQuestionRequest {
  message: string;
  fields: FormQuestionField[];
}

export type PendingQuestion =
  | {
      kind: 'input';
      message: string;
    }
  | {
      kind: 'password';
      message: string;
    }
  | {
      kind: 'confirm';
      message: string;
      defaultValue: boolean;
    }
  | {
      kind: 'select';
      message: string;
      choices: QuestionChoice[];
      allowOther?: boolean;
      otherLabel?: string;
      otherPrompt?: string;
    }
  | {
      kind: 'checklist';
      message: string;
      choices: QuestionChoice[];
      allowOther?: boolean;
      otherLabel?: string;
      otherPrompt?: string;
    }
  | {
      kind: 'form';
      message: string;
      fields: FormQuestionField[];
    };

export interface NavigateAgentTarget {
  agent: Agent;
  sessionId: string | null;
}

export interface ChatPanelMessageItem {
  message: ChatMessage;
  index: number;
  navigateTarget: NavigateAgentTarget | null;
  displayName: string;
  senderAgent: Agent | undefined;
  developerDisplayName: string;
  isHuman: boolean;
  isAgentBriefing: boolean;
  messageStyle?: CSSProperties;
}

export interface ExtractedSessionMeta {
  activatedTools: SessionActivatedTool[];
}

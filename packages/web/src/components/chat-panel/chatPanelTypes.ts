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
}

export interface PasswordQuestionRequest {
  message: string;
}

export interface ChecklistQuestionRequest {
  message: string;
  choices: QuestionChoice[];
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
    }
  | {
      kind: 'checklist';
      message: string;
      choices: QuestionChoice[];
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

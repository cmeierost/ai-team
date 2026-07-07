import type { ILlmChatMessageParam, StructuredToolResult, ExecutionContext } from '@ai-team/core';
import { z } from 'zod';

import type {
  SendTurnResolvedSkillsAndTools,
  SendTurnDeps,
  SendTurnOptions,
} from '../orchestrator/send-turn-steps.js';
export type { SendTurnDeps } from '../orchestrator/send-turn-steps.js';
import type { ResolvedPlugins, TurnResult } from '../orchestrator/pipeline.js';
import { chatSendTurnResultSchema, type ChatSendTurnResult } from './chat-loop-contracts.js';

export const sendTurnMachineOptionsSchema = z.object({
  skipPersist: z.boolean().optional(),
});

export const sendTurnMachineInputSchema = z.object({
  userMessage: z.string(),
  hop: z.number().int().nonnegative().default(0),
  options: sendTurnMachineOptionsSchema.optional(),
});

export type SendTurnMachineInput = z.infer<typeof sendTurnMachineInputSchema>;

export interface SendTurnMachineRuntimeInput extends SendTurnMachineInput {
  ctx: ExecutionContext;
  plugins: ResolvedPlugins;
  deps: SendTurnDeps;
}

export interface SendTurnMachineContext {
  userMessage: string;
  hop: number;
  options?: SendTurnOptions;
  ctx: ExecutionContext;
  plugins: ResolvedPlugins;
  deps: SendTurnDeps;
  messages: ILlmChatMessageParam[];
  resolved?: SendTurnResolvedSkillsAndTools;
  fullResponse: string;
  structuredResults: StructuredToolResult[];
  persistedContent: string;
  parsedTurnResult: TurnResult | null;
  finalTurnResult: TurnResult | null;
  invocationError?: unknown;
  errorMessage?: string;
  failureStep?: string;
}

export const turnResultSchema = z.object({
  text: z.string(),
  done: z.boolean().optional(),
  handedOff: z.boolean().optional(),
  handoffTargetId: z.string().optional(),
  handoffTargetSessionId: z.string().optional(),
  handoffNote: z.string().optional(),
});

export const sendTurnMachineOutputSchema = z.object({
  chatResult: chatSendTurnResultSchema,
  turnResult: turnResultSchema,
});

export type SendTurnMachineOutput = z.infer<typeof sendTurnMachineOutputSchema>;

export const sendTurnMachineFailureOutputSchema = z.object({
  error: z.string(),
  failedStep: z.string().optional(),
});

export type SendTurnMachineFailureOutput = z.infer<typeof sendTurnMachineFailureOutputSchema>;

export function parseSendTurnMachineInput(input: SendTurnMachineInput): SendTurnMachineInput {
  return sendTurnMachineInputSchema.parse(input);
}

export function parseSendTurnMachineOutput(output: {
  chatResult: ChatSendTurnResult;
  turnResult: TurnResult;
}): SendTurnMachineOutput {
  return sendTurnMachineOutputSchema.parse(output);
}

export function parseSendTurnMachineFailureOutput(
  output: SendTurnMachineFailureOutput
): SendTurnMachineFailureOutput {
  return sendTurnMachineFailureOutputSchema.parse(output);
}

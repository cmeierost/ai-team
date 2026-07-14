/**
 * Example: Composable Workflows
 *
 * This file demonstrates how workflows can be:
 * 1. Converted to commands using WorkflowRunnerFactory.asCommand()
 * 2. Registered in the DI container
 * 3. Composed together by calling one workflow from another
 *
 * @example
 * // Define a simple workflow
 * const emailWorkflow: WorkflowDefinition<EmailState> = {
 *   id: 'send-email',
 *   description: 'Send an email notification',
 *   availableIn: { tool: true },
 *   prepare: (params) => ({ recipient: params.to, body: params.message }),
 *   toResult: (state) => ({ sent: true, messageId: state.messageId }),
 *   steps: [
 *     {
 *       id: 'validate',
 *       execute: async (state) => ({
 *         ...state,
 *         validated: isValidEmail(state.recipient)
 *       })
 *     },
 *     {
 *       id: 'send',
 *       command: 'email-send',
 *       params: (state) => ({ to: state.recipient, body: state.body }),
 *       applyResult: (state, result) => ({ ...state, messageId: result.id })
 *     }
 *   ]
 * };
 *
 * // Convert to command
 * const emailCommand = workflowFactory.asCommand(emailWorkflow);
 *
 * // Register it
 * container.registerInstance('send-email', emailCommand);
 *
 * // Now compose it in another workflow
 * const notifyWorkflow: WorkflowDefinition<NotifyState> = {
 *   id: 'notify-team',
 *   description: 'Notify team members via email',
 *   availableIn: { tool: true },
 *   steps: [
 *     {
 *       id: 'send-to-lead',
 *       command: 'send-email',  // Reference the email workflow!
 *       params: (state) => ({
 *         to: state.leadEmail,
 *         message: `Project ${state.projectName} completed`
 *       })
 *     },
 *     {
 *       kind: 'loop',
 *       id: 'notify-members',
 *       while: 'memberIndex < members.length',
 *       steps: [
 *         {
 *           id: 'send-member-email',
 *           command: 'send-email',  // Reuse the same workflow
 *           params: (state) => ({
 *             to: state.members[state.memberIndex],
 *             message: `Project ${state.projectName} completed`
 *           })
 *         }
 *       ]
 *     }
 *   ]
 * };
 */

import type { WorkflowDefinition } from './workflow-types.js';
import type { ICommand } from '@ai-team/core';
import type { IWorkflowRunnerFactory } from './xstate-workflow-runner.js';

/**
 * Example: Simple approval workflow that can be composed
 */
interface ApprovalWorkflowState {
  requestId: string;
  requestedBy: string;
  approvedBy?: string;
  approved?: boolean;
  rejectionReason?: string;
}

export function createApprovalWorkflow(): WorkflowDefinition<ApprovalWorkflowState> {
  return {
    id: 'approval-workflow',
    description: 'Simple approval workflow that can be composed into larger processes',
    availableIn: { tool: true, cli: false, chat: false },
    prepare: (params: unknown) => params as ApprovalWorkflowState,
    toResult: (state) => ({
      approved: state.approved ?? false,
      approvedBy: state.approvedBy,
      rejectionReason: state.rejectionReason,
    }),
    steps: [
      {
        id: 'check-approval',
        command: 'com_ask',
        params: (state) => ({
          question: `Approve request ${state.requestId} from ${state.requestedBy}?`,
          choices: [
            { label: 'Approve', value: 'yes' },
            { label: 'Reject', value: 'no' },
          ],
        }),
        applyResult: (state, result: any) => ({
          ...state,
          approved: result.answer === 'yes',
          approvedBy: result.answer === 'yes' ? 'current-user' : undefined,
        }),
      },
      {
        id: 'get-rejection-reason',
        skipWhen: 'approved === true',
        command: 'com_ask',
        params: () => ({
          question: 'Please provide a reason for rejection:',
        }),
        applyResult: (state, result: any) => ({
          ...state,
          rejectionReason: result.answer,
        }),
      },
    ],
  };
}

/**
 * Example: Multi-step hiring workflow that composes the approval workflow
 */
interface HiringProcessState {
  candidateName: string;
  candidateEmail: string;
  role: string;
  resumeReviewed?: boolean;
  technicalApproval?: {
    approved: boolean;
    approvedBy?: string;
    rejectionReason?: string;
  };
  hrApproval?: {
    approved: boolean;
    approvedBy?: string;
    rejectionReason?: string;
  };
  finalStatus?: 'hired' | 'rejected';
}

export function createHiringProcessWorkflow(): WorkflowDefinition<HiringProcessState> {
  return {
    id: 'hiring-process',
    description: 'Multi-stage hiring process that composes approval workflows',
    availableIn: { tool: true, cli: false, chat: false },
    prepare: (params: unknown) => params as HiringProcessState,
    toResult: (state) => ({
      hired: state.finalStatus === 'hired',
      candidateName: state.candidateName,
      technicalApproval: state.technicalApproval,
      hrApproval: state.hrApproval,
    }),
    steps: [
      {
        id: 'review-resume',
        execute: async (state) => ({
          ...state,
          resumeReviewed: true,
        }),
      },
      {
        id: 'technical-approval',
        command: 'approval-workflow', // Compose the approval workflow
        params: (state) => ({
          requestId: `hire-${state.candidateName}-technical`,
          requestedBy: 'recruiter',
        }),
        applyResult: (state, result: any) => ({
          ...state,
          technicalApproval: result,
        }),
      },
      {
        id: 'hr-approval',
        skipWhen: 'technicalApproval.approved !== true',
        command: 'approval-workflow', // Reuse the same approval workflow
        params: (state) => ({
          requestId: `hire-${state.candidateName}-hr`,
          requestedBy: 'technical-team',
        }),
        applyResult: (state, result: any) => ({
          ...state,
          hrApproval: result,
        }),
      },
      {
        id: 'determine-final-status',
        execute: async (state) => ({
          ...state,
          finalStatus:
            state.technicalApproval?.approved && state.hrApproval?.approved ? 'hired' : 'rejected',
        }),
      },
    ],
  };
}

/**
 * Register composable workflows
 *
 * @example
 * const factory = container.resolve<IWorkflowRunnerFactory>(TOKENS.WorkflowRunnerFactory);
 * registerComposableWorkflows(factory, container);
 */
export function registerComposableWorkflows(
  factory: IWorkflowRunnerFactory,
  container: { registerInstance: (key: string, instance: ICommand) => void }
): void {
  // Register approval workflow as a command
  const approvalCommand = factory.asCommand(createApprovalWorkflow());
  container.registerInstance('approval-workflow', approvalCommand);

  // Register hiring process workflow as a command (which uses approval workflow internally)
  const hiringCommand = factory.asCommand(createHiringProcessWorkflow());
  container.registerInstance('hiring-process', hiringCommand);
}

/**
 * Usage example in another workflow
 *
 * @example
 * const deployWorkflow: WorkflowDefinition<DeployState> = {
 *   id: 'deploy-with-approval',
 *   steps: [
 *     {
 *       id: 'request-deploy-approval',
 *       command: 'approval-workflow',  // Compose the approval workflow!
 *       params: (state) => ({
 *         requestId: `deploy-${state.environment}`,
 *         requestedBy: state.deployedBy
 *       }),
 *       applyResult: (state, result) => ({
 *         ...state,
 *         deployApproved: result.approved
 *       })
 *     },
 *     {
 *       id: 'execute-deploy',
 *       skipWhen: 'deployApproved !== true',
 *       command: 'kubectl-apply',
 *       params: (state) => ({ manifest: state.manifestPath })
 *     }
 *   ]
 * };
 */

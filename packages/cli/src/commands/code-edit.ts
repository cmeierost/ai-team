/**
 * Code Edit Proposals Command - Review and apply code edit proposals
 */

import chalk from 'chalk';
import { CodeEditManager, ProposalStatus, type CodeEditProposal } from '@ai-team/core';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface CodeEditCommandOptions {
  status?: string;
  agent?: string;
  apply?: string;
  approve?: string;
  reject?: string;
}

export async function codeEditCommand(
  workspaceRoot: string,
  options: CodeEditCommandOptions
): Promise<void> {
  const manager = new CodeEditManager();

  // Apply a specific proposal
  if (options.apply) {
    await applyProposal(manager, options.apply);
    return;
  }

  // Approve a proposal
  if (options.approve) {
    await approveProposal(manager, options.approve);
    return;
  }

  // Reject a proposal
  if (options.reject) {
    await rejectProposal(manager, options.reject);
    return;
  }

  // List proposals
  await listProposals(manager, options);
}

async function listProposals(
  manager: CodeEditManager,
  options: CodeEditCommandOptions
): Promise<void> {
  let proposals = manager.getAllProposals();

  // Filter by status
  if (options.status) {
    const status = options.status.toUpperCase() as ProposalStatus;
    proposals = manager.getProposalsByStatus(status);
  }

  // Filter by agent
  if (options.agent) {
    proposals = proposals.filter((p) => p.agentName === options.agent);
  }

  if (proposals.length === 0) {
    console.log(chalk.yellow('No code edit proposals found.'));
    return;
  }

  console.log(chalk.bold.cyan('\n📝 Code Edit Proposals\n'));

  // Group by status
  const grouped = {
    [ProposalStatus.PENDING]: proposals.filter(
      (p) => p.status === ProposalStatus.PENDING
    ),
    [ProposalStatus.APPROVED]: proposals.filter(
      (p) => p.status === ProposalStatus.APPROVED
    ),
    [ProposalStatus.APPLIED]: proposals.filter(
      (p) => p.status === ProposalStatus.APPLIED
    ),
    [ProposalStatus.REJECTED]: proposals.filter(
      (p) => p.status === ProposalStatus.REJECTED
    ),
    [ProposalStatus.FAILED]: proposals.filter(
      (p) => p.status === ProposalStatus.FAILED
    ),
  };

  for (const [status, statusProposals] of Object.entries(grouped)) {
    if (statusProposals.length === 0) continue;

    const icon = getStatusIcon(status as ProposalStatus);
    const color = getStatusColor(status as ProposalStatus);

    console.log(color(`${icon} ${status} (${statusProposals.length})`));
    console.log(chalk.gray('─'.repeat(60)));

    for (const proposal of statusProposals) {
      displayProposal(proposal);
      console.log('');
    }
  }

  // Show statistics
  const stats = manager.getStatistics();
  console.log(chalk.bold('\nStatistics:'));
  console.log(`  Total: ${stats.total}`);
  console.log(`  Pending: ${chalk.yellow(stats.pending)}`);
  console.log(`  Approved: ${chalk.blue(stats.approved)}`);
  console.log(`  Applied: ${chalk.green(stats.applied)}`);
  console.log(`  Rejected: ${chalk.red(stats.rejected)}`);
  console.log(`  Failed: ${chalk.red(stats.failed)}`);

  // Show available actions
  console.log(chalk.dim('\nActions:'));
  console.log(chalk.dim('  ait code-edit --approve <id>  Approve a proposal'));
  console.log(chalk.dim('  ait code-edit --apply <id>    Apply an approved proposal'));
  console.log(chalk.dim('  ait code-edit --reject <id>   Reject a proposal'));
}

function displayProposal(proposal: CodeEditProposal): void {
  const totalAdditions = proposal.changes.reduce((sum, c) => sum + c.diff.additions, 0);
  const totalDeletions = proposal.changes.reduce((sum, c) => sum + c.diff.deletions, 0);

  console.log(`  ${chalk.bold(proposal.id.substring(0, 12))}...`);
  console.log(`  ${proposal.description}`);
  console.log(
    chalk.gray(
      `  By ${proposal.agentName} • ${new Date(proposal.timestamp).toLocaleString()}`
    )
  );
  console.log(
    `  📁 ${proposal.changes.length} file${proposal.changes.length !== 1 ? 's' : ''} • ${chalk.green(`+${totalAdditions}`)} ${chalk.red(`-${totalDeletions}`)}`
  );

  if (proposal.changes.length <= 3) {
    console.log(chalk.dim('  Files:'));
    proposal.changes.forEach((change) => {
      console.log(chalk.dim(`    • ${change.filePath}`));
    });
  }
}

function getStatusIcon(status: ProposalStatus): string {
  switch (status) {
    case ProposalStatus.PENDING:
      return '⏳';
    case ProposalStatus.APPROVED:
      return '✅';
    case ProposalStatus.APPLIED:
      return '🚀';
    case ProposalStatus.REJECTED:
      return '❌';
    case ProposalStatus.FAILED:
      return '💥';
    default:
      return '📦';
  }
}

function getStatusColor(status: ProposalStatus) {
  switch (status) {
    case ProposalStatus.PENDING:
      return chalk.yellow;
    case ProposalStatus.APPROVED:
      return chalk.blue;
    case ProposalStatus.APPLIED:
      return chalk.green;
    case ProposalStatus.REJECTED:
      return chalk.red;
    case ProposalStatus.FAILED:
      return chalk.red.bold;
    default:
      return chalk.white;
  }
}

async function approveProposal(
  manager: CodeEditManager,
  proposalId: string
): Promise<void> {
  try {
    const proposal = manager.getProposal(proposalId);
    if (!proposal) {
      console.error(chalk.red(`Proposal ${proposalId} not found`));
      process.exit(1);
    }

    if (proposal.status !== ProposalStatus.PENDING) {
      console.error(
        chalk.red(`Proposal ${proposalId} is not pending (status: ${proposal.status})`)
      );
      process.exit(1);
    }

    manager.approveProposal(proposalId);
    console.log(chalk.green(`✅ Proposal ${proposalId} approved`));
    console.log(chalk.dim(`Run: ait code-edit --apply ${proposalId}`));
  } catch (error) {
    console.error(chalk.red(`Failed to approve proposal: ${error}`));
    process.exit(1);
  }
}

async function rejectProposal(
  manager: CodeEditManager,
  proposalId: string
): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    const proposal = manager.getProposal(proposalId);
    if (!proposal) {
      console.error(chalk.red(`Proposal ${proposalId} not found`));
      process.exit(1);
    }

    if (proposal.status !== ProposalStatus.PENDING) {
      console.error(
        chalk.red(`Proposal ${proposalId} is not pending (status: ${proposal.status})`)
      );
      process.exit(1);
    }

    const reason = await rl.question('Reason for rejection (optional): ');
    manager.rejectProposal(proposalId, reason || 'Rejected by user');

    console.log(chalk.red(`❌ Proposal ${proposalId} rejected`));
  } catch (error) {
    console.error(chalk.red(`Failed to reject proposal: ${error}`));
    process.exit(1);
  } finally {
    rl.close();
  }
}

async function applyProposal(
  manager: CodeEditManager,
  proposalId: string
): Promise<void> {
  try {
    const proposal = manager.getProposal(proposalId);
    if (!proposal) {
      console.error(chalk.red(`Proposal ${proposalId} not found`));
      process.exit(1);
    }

    if (proposal.status !== ProposalStatus.APPROVED) {
      console.error(
        chalk.red(
          `Proposal ${proposalId} is not approved (status: ${proposal.status}). Approve it first with: ait code-edit --approve ${proposalId}`
        )
      );
      process.exit(1);
    }

    // Show preview
    console.log(chalk.bold.cyan('\n📝 Applying Code Edit Proposal\n'));
    displayProposal(proposal);
    console.log('');

    // Show detailed diffs
    const diffs = manager.getTerminalDiffs(proposalId);
    for (const diff of diffs) {
      console.log(diff);
      console.log('');
    }

    // Confirm
    const rl = createInterface({ input, output });
    try {
      const answer = await rl.question(
        chalk.yellow('Apply these changes to the workspace? [y/N]: ')
      );

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(chalk.yellow('Operation cancelled'));
        return;
      }
    } finally {
      rl.close();
    }

    // Apply
    await manager.applyProposal(proposalId);
    console.log(chalk.green(`\n🚀 Proposal ${proposalId} applied successfully!`));

    // Show modified files
    console.log(chalk.dim('\nModified files:'));
    proposal.changes.forEach((change) => {
      console.log(chalk.dim(`  • ${change.filePath}`));
    });
  } catch (error) {
    console.error(chalk.red(`\nFailed to apply proposal: ${error}`));
    process.exit(1);
  }
}

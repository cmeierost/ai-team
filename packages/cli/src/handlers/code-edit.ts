/**
 * Code Edit Proposals Command - pure CLI renderers
 */

import chalk from 'chalk';
import type { CodeEditListResponse, CodeEditProposalSummary } from '@ai-team/api-contracts';

export function renderCodeEditList(
  data: CodeEditListResponse,
  options: { json?: boolean } = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.proposals.length === 0) {
    console.log(chalk.yellow('No code edit proposals found.'));
    return;
  }

  console.log(chalk.bold.cyan('\n📝 Code Edit Proposals\n'));

  const grouped = new Map<string, CodeEditProposalSummary[]>();
  for (const p of data.proposals) {
    const list = grouped.get(p.status) ?? [];
    list.push(p);
    grouped.set(p.status, list);
  }

  for (const [status, proposals] of grouped) {
    const icon = getStatusIcon(status);
    const color = getStatusColor(status);

    console.log(color(`${icon} ${status} (${proposals.length})`));
    console.log(chalk.gray('─'.repeat(60)));

    for (const proposal of proposals) {
      displayProposal(proposal);
      console.log('');
    }
  }

  console.log(chalk.bold('\nStatistics:'));
  console.log(`  Total: ${data.stats.total}`);
  console.log(`  Pending: ${chalk.yellow(data.stats.pending)}`);
  console.log(`  Approved: ${chalk.blue(data.stats.approved)}`);
  console.log(`  Applied: ${chalk.green(data.stats.applied)}`);
  console.log(`  Rejected: ${chalk.red(data.stats.rejected)}`);
  console.log(`  Failed: ${chalk.red(data.stats.failed)}`);

  console.log(chalk.dim('\nActions:'));
  console.log(chalk.dim('  ait code-edit --approve <id>  Approve a proposal'));
  console.log(chalk.dim('  ait code-edit --apply <id>    Apply an approved proposal'));
  console.log(chalk.dim('  ait code-edit --reject <id>   Reject a proposal'));
}

export function renderCodeEditApprove(data: { proposalId: string }): void {
  console.log(chalk.green(`✅ Proposal ${data.proposalId} approved`));
  console.log(chalk.dim(`Run: ait code-edit --apply ${data.proposalId}`));
}

export function renderCodeEditReject(data: { proposalId: string }): void {
  console.log(chalk.red(`❌ Proposal ${data.proposalId} rejected`));
}

export function renderCodeEditApply(data: { proposalId: string; files: string[] }): void {
  console.log(chalk.green(`\n🚀 Proposal ${data.proposalId} applied successfully!`));
  console.log(chalk.dim('\nModified files:'));
  for (const file of data.files) {
    console.log(chalk.dim(`  • ${file}`));
  }
}

function displayProposal(proposal: CodeEditProposalSummary): void {
  console.log(`  ${chalk.bold(proposal.id.substring(0, 12))}...`);
  console.log(`  ${proposal.description}`);
  console.log(
    chalk.gray(`  By ${proposal.agentName} • ${new Date(proposal.timestamp).toLocaleString()}`)
  );
  console.log(
    `  📁 ${proposal.filesChanged} file${proposal.filesChanged !== 1 ? 's' : ''} • ${chalk.green(`+${proposal.additions}`)} ${chalk.red(`-${proposal.deletions}`)}`
  );

  if (proposal.files.length <= 3) {
    console.log(chalk.dim('  Files:'));
    for (const file of proposal.files) {
      console.log(chalk.dim(`    • ${file}`));
    }
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'PENDING':
      return '⏳';
    case 'APPROVED':
      return '✅';
    case 'APPLIED':
      return '🚀';
    case 'REJECTED':
      return '❌';
    case 'FAILED':
      return '💥';
    default:
      return '📦';
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'PENDING':
      return chalk.yellow;
    case 'APPROVED':
      return chalk.blue;
    case 'APPLIED':
      return chalk.green;
    case 'REJECTED':
      return chalk.red;
    case 'FAILED':
      return chalk.red.bold;
    default:
      return chalk.white;
  }
}

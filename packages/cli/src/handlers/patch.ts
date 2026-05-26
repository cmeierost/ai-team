/**
 * Patch command - pure CLI renderer
 */

import chalk from 'chalk';

export function renderPatchApply(data: { proposalId: string; patchedLines: number }): void {
  console.log(chalk.green(`Patched ${data.patchedLines} line(s)`));
  console.log(chalk.dim(`Proposal saved: ${data.proposalId}`));
}

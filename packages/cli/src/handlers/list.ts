/**
 * List command - render agent list
 */

import chalk from 'chalk';
import type { Agent } from '@ai-team/api-client';

interface ListRenderOptions {
  json?: boolean;
}

export function renderAgentList(employees: Agent[], options: ListRenderOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(employees, null, 2));
    return;
  }

  if (employees.length === 0) {
    console.log(
      chalk.yellow('No team members found. Run') +
        ' ai-team init ' +
        chalk.yellow('to get started.')
    );
    return;
  }

  console.log(chalk.bold(`\n${employees.length} Team Members\n`));

  for (const employee of employees) {
    const status = getStatusIcon(employee.status);
    console.log(`${status} ${chalk.cyan(employee.name)} ${chalk.dim(`(${employee.role})`)}`);

    if (employee.reportsTo) {
      console.log(chalk.dim(`  ├─ Reports to: ${employee.reportsTo}`));
    }

    if (employee.features && employee.features.length > 0) {
      console.log(chalk.dim(`  ├─ Features: ${employee.features.join(', ')}`));
    }

    if (employee.conversationCount) {
      console.log(chalk.dim(`  └─ Conversations: ${employee.conversationCount}`));
    }

    console.log('');
  }
}

function getStatusIcon(status?: string): string {
  switch (status) {
    case 'available':
      return chalk.green('●');
    case 'busy':
      return chalk.yellow('●');
    case 'in-meeting':
      return chalk.blue('●');
    case 'offline':
      return chalk.gray('●');
    default:
      return chalk.gray('○');
  }
}

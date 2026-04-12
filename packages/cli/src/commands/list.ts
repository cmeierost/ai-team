/**
 * List command - list all agents
 */

import chalk from 'chalk';
import type { IAgentsService, ListEmployeesRequest, Agent } from '@ai-team/api-client';

interface ListOptions extends ListEmployeesRequest {
  json?: boolean;
}

export async function listCommand(client: IAgentsService, options: ListOptions) {
  try {
    let employees: Agent[];
    if (options.role || options.feature) {
      const response = await client.search({ role: options.role, feature: options.feature });
      employees = response.results.map((r) => r.agent);
    } else {
      employees = await client.list();
    }

    if (options.json) {
      console.log(JSON.stringify(employees, null, 2));
      return;
    }

    // Pretty print
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
  } catch (error) {
    console.error(chalk.red('Error listing team members:'), error);
    process.exit(1);
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

/**
 * Search command - render agent search results
 */

import chalk from 'chalk';
import type { SearchAgentsResponse } from '@ai-team/api-contracts';

export interface SearchRenderOptions {
  query?: string;
  json?: boolean;
  hasFilters?: boolean;
}

export function renderSearchResults(
  response: SearchAgentsResponse,
  options: SearchRenderOptions = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (response.results.length === 0) {
    console.log(chalk.yellow('No agents found.'));
    if (options.query) {
      console.log(chalk.dim(`Try a different search term or run 'ait list' to see all agents.`));
    }
    return;
  }

  if (options.query && options.hasFilters) {
    console.log(
      chalk.bold(
        `\nFound ${response.totalCount} agents matching "${options.query}" with filters:\n`
      )
    );
  } else if (options.query) {
    console.log(chalk.bold(`\nFound ${response.totalCount} agents matching "${options.query}":\n`));
  } else {
    console.log(chalk.bold(`\nFound ${response.totalCount} agents:\n`));
  }

  for (const result of response.results) {
    const agent = result.agent;
    const status = getStatusIcon(agent.status);

    const badges: string[] = [];

    if (agent.specializations && agent.specializations.length > 0) {
      const specs = agent.specializations.slice(0, 3);
      specs.forEach((s: string) => badges.push(chalk.blue(`[${s}]`)));
      if (agent.specializations.length > 3) {
        badges.push(chalk.dim(`+${agent.specializations.length - 3}`));
      }
    }

    const matchPreview =
      result.matches.length > 0 ? chalk.dim(`matched: ${result.matches.join(', ')}`) : '';

    const scoreIndicator =
      result.score >= 90
        ? chalk.green('★★★')
        : result.score >= 70
          ? chalk.green('★★')
          : result.score >= 50
            ? chalk.yellow('★')
            : '';

    const badgesStr = badges.length > 0 ? ' ' + badges.join(' ') : '';
    const matchStr = matchPreview ? ' - ' + matchPreview : '';

    console.log(
      `${status} ${chalk.cyan(agent.name)} ${chalk.dim(`(${agent.role})`)}${badgesStr}${matchStr} ${scoreIndicator}`
    );
  }

  console.log('');
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

/**
 * Search command - search for agents with fuzzy matching
 */

import chalk from 'chalk';
import type { AiTeamClient } from '@ai-team/api-client';

interface SearchOptions {
  role?: string | string[];
  type?: string | string[];
  status?: string | string[];
  feature?: string | string[];
  specialization?: string | string[];
  tool?: string | string[];
  reportsTo?: string;
  contextLevel?: string | string[];
  json?: boolean;
}

export async function searchCommand(
  client: AiTeamClient,
  query: string | undefined,
  options: SearchOptions
) {
  try {
    const request = {
      query,
      role: options.role,
      type: options.type as any,
      status: options.status as any,
      feature: options.feature,
      specialization: options.specialization,
      tool: options.tool,
      reportsTo: options.reportsTo,
      contextLevel: options.contextLevel as any,
    };

    const response = await client.searchAgents(request);

    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Pretty print compact results
    if (response.results.length === 0) {
      console.log(chalk.yellow('No agents found.'));
      if (query) {
        console.log(chalk.dim(`Try a different search term or run 'ait list' to see all agents.`));
      }
      return;
    }

    const hasFilters = !!(options.role || options.type || options.status || options.feature || 
                          options.specialization || options.tool || options.reportsTo || options.contextLevel);
    
    if (query && hasFilters) {
      console.log(chalk.bold(`\nFound ${response.totalCount} agents matching "${query}" with filters:\n`));
    } else if (query) {
      console.log(chalk.bold(`\nFound ${response.totalCount} agents matching "${query}":\n`));
    } else {
      console.log(chalk.bold(`\nFound ${response.totalCount} agents:\n`));
    }

    for (const result of response.results) {
      const agent = result.agent;
      const status = getStatusIcon(agent.status);
      
      // Build compact one-line output
      const badges: string[] = [];
      
      // Add specializations as badges (max 3)
      if (agent.specializations && agent.specializations.length > 0) {
        const specs = agent.specializations.slice(0, 3);
        specs.forEach(s => badges.push(chalk.blue(`[${s}]`)));
        if (agent.specializations.length > 3) {
          badges.push(chalk.dim(`+${agent.specializations.length - 3}`));
        }
      }
      
      // Build match preview
      const matchPreview = result.matches.length > 0 
        ? chalk.dim(`matched: ${result.matches.join(', ')}`)
        : '';
      
      // Score indicator for debugging (optional)
      const scoreIndicator = result.score >= 90 ? chalk.green('★★★') : 
                            result.score >= 70 ? chalk.green('★★') :
                            result.score >= 50 ? chalk.yellow('★') : '';
      
      const badgesStr = badges.length > 0 ? ' ' + badges.join(' ') : '';
      const matchStr = matchPreview ? ' - ' + matchPreview : '';
      
      console.log(`${status} ${chalk.cyan(agent.name)} ${chalk.dim(`(${agent.role})`)}${badgesStr}${matchStr} ${scoreIndicator}`);
    }
    
    console.log('');
  } catch (error) {
    console.error(chalk.red('Error searching agents:'), error);
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

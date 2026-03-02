/**
 * System information command - display workspace, git, and package info
 */

import chalk from 'chalk';
import { getSystemInfo, findWorkspaceRoot } from '@ai-team/service';

interface SysInfoOptions {
  json?: boolean;
}

export async function sysinfoCommand(options: SysInfoOptions = {}) {
  const workspaceRoot = findWorkspaceRoot();
  const info = getSystemInfo(workspaceRoot);

  if (options.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log(chalk.bold('\n  System Information\n'));
  console.log(chalk.dim('  Workspace:    ') + info.workspace);
  console.log(chalk.dim('  Branch:       ') + (info.branch || chalk.yellow('not a git repository')));

  if (info.package) {
    console.log(chalk.dim('  Package:      ') + (info.package.name || chalk.yellow('unnamed')));
    console.log(chalk.dim('  Version:      ') + (info.package.version || chalk.yellow('unversioned')));
    if (info.package.description) {
      console.log(chalk.dim('  Description:  ') + info.package.description);
    }
  } else {
    console.log(chalk.dim('  Package:      ') + chalk.yellow('no package.json found'));
  }

  console.log();
}

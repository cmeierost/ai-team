/**
 * System information command - pure CLI renderer
 */

import chalk from 'chalk';
import type { SystemInfoResponse } from '@ai-team/api-client';

interface SysInfoOptions {
  json?: boolean;
}

export function renderSysinfo(data: SystemInfoResponse, options: SysInfoOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(chalk.bold('\n  System Information\n'));
  console.log(chalk.dim('  Workspace:    ') + data.workspace);
  console.log(
    chalk.dim('  Branch:       ') + (data.branch || chalk.yellow('not a git repository'))
  );

  if (data.package) {
    console.log(chalk.dim('  Package:      ') + (data.package.name || chalk.yellow('unnamed')));
    console.log(
      chalk.dim('  Version:      ') + (data.package.version || chalk.yellow('unversioned'))
    );
    if (data.package.description) {
      console.log(chalk.dim('  Description:  ') + data.package.description);
    }
  } else {
    console.log(chalk.dim('  Package:      ') + chalk.yellow('no package.json found'));
  }

  console.log();
}

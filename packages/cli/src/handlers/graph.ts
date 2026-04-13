/**
 * Graph command - render team structure
 */

import chalk from 'chalk';
import type { GraphData } from '@ai-team/api-client';

interface GraphRenderOptions {
  mode?: string;
}

export async function renderTeamGraph(
  graphData: GraphData,
  options: GraphRenderOptions = {}
): Promise<void> {
  const mode = options.mode || 'hierarchy';

  console.log(chalk.bold(`\nTeam Graph (${mode} view)\n`));
  console.log(chalk.dim(`Nodes: ${graphData.nodes.length}`));
  console.log(chalk.dim(`Edges: ${graphData.edges.length}\n`));

  if (mode === 'hierarchy') {
    printHierarchy(graphData);
  } else {
    console.log(chalk.yellow('ASCII visualization only available for hierarchy mode'));
    console.log(chalk.dim('Use --output graph.json for full data'));
    console.log(chalk.dim('Or use the web dashboard for interactive visualization'));
  }
}

function printHierarchy(graphData: any) {
  const { nodes, edges } = graphData;

  // Find roots (no incoming reports-to edges)
  const hasManager = new Set(
    edges.filter((e: any) => e.type === 'reports-to').map((e: any) => e.source)
  );

  const roots = nodes.filter((n: any) => !hasManager.has(n.id));

  const printed = new Set<string>();

  function printNode(nodeId: string, indent: number = 0) {
    if (printed.has(nodeId)) return;
    printed.add(nodeId);

    const node = nodes.find((n: any) => n.id === nodeId);
    if (!node) return;

    const prefix = '  '.repeat(indent);
    const status = node.data.status ? getStatusIcon(node.data.status) : '○';

    console.log(
      `${prefix}${status} ${chalk.cyan(node.data.label)} ${chalk.dim(`(${node.data.role})`)}`
    );

    // Find direct reports
    const reports = edges
      .filter((e: any) => e.type === 'reports-to' && e.target === nodeId)
      .map((e: any) => e.source);

    for (const reportId of reports) {
      printNode(reportId, indent + 1);
    }
  }

  // Print hierarchy starting from roots
  for (const root of roots) {
    printNode(root.id);
  }

  // Print agents with broken parent references
  const brokenEdges = edges.filter((e: any) => e.type === 'reports-to-unresolved');

  if (brokenEdges.length > 0) {
    console.log();
    console.log(chalk.yellow('⚠ Unresolved reporting relationships:'));

    for (const edge of brokenEdges) {
      const node = nodes.find((n: any) => n.id === edge.source);
      if (node) {
        const icon = chalk.red('✗');
        console.log(
          `  ${icon} ${chalk.cyan(node.data.label)} ${chalk.dim(`(${node.data.role})`)} → ${chalk.red(`[${edge.target}]`)}`
        );
        if (edge.error) {
          console.log(`    ${chalk.dim(edge.error)}`);
        }
      }
    }
  }
}

function getStatusIcon(status: string): string {
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

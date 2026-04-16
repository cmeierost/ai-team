/**
 * Org command - render organization overview (hierarchy)
 */

import chalk from 'chalk';
import type { GraphData } from '@ai-team/api-client';

interface OrgRenderOptions {
  mermaid?: boolean;
  output?: string;
}

export async function renderOrgGraph(
  graphData: GraphData,
  options: OrgRenderOptions = {}
): Promise<void> {
  if (!graphData.nodes.length) {
    console.log(chalk.yellow('\n⚠ No agents found in this workspace.'));
    console.log(chalk.dim('  Run "ait init" to set up your AI team,'));
    console.log(chalk.dim('  or use "ait hire" / "ait create" to add agents.'));
    return;
  }

  if (options.mermaid) {
    const mermaid = buildMermaid(graphData);

    if (options.output) {
      const fs = await import('fs/promises');
      await fs.writeFile(options.output, mermaid, 'utf-8');
      console.log(chalk.green(`✓ Exported Mermaid org chart to ${options.output}`));
    } else {
      console.log(mermaid);
    }
    return;
  }

  if (options.output) {
    const fs = await import('fs/promises');
    if (options.output.endsWith('.json')) {
      await fs.writeFile(options.output, JSON.stringify(graphData, null, 2));
      console.log(chalk.green(`✓ Exported org graph to ${options.output}`));
    } else {
      console.log(chalk.yellow('Only JSON export is currently supported for --output'));
      console.log(chalk.dim('Use --mermaid to export a Mermaid diagram instead.'));
    }
    return;
  }

  console.log(chalk.bold('\nOrganization (hierarchy view)\n'));
  console.log(chalk.dim(`Nodes: ${graphData.nodes.length}`));
  console.log(chalk.dim(`Edges: ${graphData.edges.length}\n`));

  printHierarchy(graphData);
}

function printHierarchy(graphData: any) {
  const { nodes, edges } = graphData;

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

    const reports = edges
      .filter((e: any) => e.type === 'reports-to' && e.target === nodeId)
      .map((e: any) => e.source);

    for (const reportId of reports) {
      printNode(reportId, indent + 1);
    }
  }

  for (const root of roots) {
    printNode(root.id);
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

function buildMermaid(graphData: any): string {
  const { nodes, edges } = graphData;

  const lines: string[] = ['graph TD'];

  for (const node of nodes) {
    const id = node.id;
    const label = `${node.data.label} (${node.data.role})`;
    const safeLabel = label.replace(/"/g, '\\"');
    lines.push(`  ${id}["${safeLabel}"]`);
  }

  for (const edge of edges) {
    if (edge.type !== 'reports-to') continue;
    const reportId = edge.source;
    const managerId = edge.target;
    lines.push(`  ${managerId} --> ${reportId}`);
  }

  return lines.join('\n');
}

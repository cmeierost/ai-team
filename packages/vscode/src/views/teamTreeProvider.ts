/**
 * Team tree view provider - shows agents in sidebar
 */

import * as vscode from 'vscode';
import { AgentManager, Agent } from '@ai-team/core';

type TreeNode = AgentItem | InfoItem;

export class TeamTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private agentManager: AgentManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      // Root level - show all agents grouped by role or hierarchy
      const agents = this.agentManager.getAllAgents();

      if (agents.length === 0) {
        return [new InfoItem('No team members found. Click + to create.')];
      }

      // Group by reporting structure
      const roots = agents.filter(a => !a.reportsTo);
      return roots.map(a => new AgentItem(a, this.agentManager));
    }

    // Show direct reports
    if (element instanceof AgentItem) {
      const reports = this.agentManager.getDirectReports(element.agentId);
      return reports.map(a => new AgentItem(a, this.agentManager));
    }

    return [];
  }
}

class AgentItem extends vscode.TreeItem {
  agentId: string;

  constructor(agent: Agent, private agentManager: AgentManager) {
    const hasReports = agentManager.getDirectReports(agent.id).length > 0;
    
    super(
      agent.name,
      hasReports
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.agentId = agent.id;
    this.description = agent.role;
    this.tooltip = `${agent.name} (${agent.role})\nContext: ${agent.contextLevel}${
      agent.conversationCount ? `\nConversations: ${agent.conversationCount}` : ''
    }`;

    // Status icon
    this.iconPath = new vscode.ThemeIcon(
      'person',
      agent.status === 'available' ? new vscode.ThemeColor('testing.iconPassed') :
      agent.status === 'busy' ? new vscode.ThemeColor('testing.iconQueued') :
      undefined
    );

    this.contextValue = 'agent';

    // Make clickable to open agent file
    this.command = {
      command: 'vscode.open',
      title: 'Open Agent File',
      arguments: [vscode.Uri.file(agent.filePath)],
    };
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
    this.contextValue = 'info';
  }
}

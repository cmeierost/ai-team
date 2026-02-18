/**
 * Team Tree View - shows agents in VS Code sidebar
 */

import * as vscode from 'vscode';
import { Agent, AgentManager } from '@ai-team/core';

export class TeamTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private agentManager: AgentManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      // Root level - show all agents grouped by reporting structure
      const agents = this.agentManager.getAllAgents();
      
      if (agents.length === 0) {
        return [];
      }

      // Find root agents (those without managers)
      const rootAgents = agents.filter(a => !a.reportsTo);
      return rootAgents.map(agent => new AgentTreeItem(agent, this.agentManager));
    } else if (element instanceof AgentTreeItem) {
      // Show direct reports
      const reports = this.agentManager.getDirectReports(element.agent.id);
      return reports.map(agent => new AgentTreeItem(agent, this.agentManager));
    }

    return [];
  }
}

class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agent: Agent,
    private agentManager: AgentManager
  ) {
    super(
      agent.name,
      vscode.TreeItemCollapsibleState.Collapsed
    );

    this.description = agent.role;
    this.tooltip = `${agent.name} (${agent.role})`;
    
    // Set icon based on status
    this.iconPath = new vscode.ThemeIcon(
      'person',
      agent.status === 'available' 
        ? new vscode.ThemeColor('charts.green')
        : undefined
    );

    // Add context value for menu items
    this.contextValue = 'agent';

    // Check if has reports
    const reports = this.agentManager.getDirectReports(agent.id);
    if (reports.length === 0) {
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }
  }
}

type TreeItem = AgentTreeItem;

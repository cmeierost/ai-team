/**
 * Features tree view provider - shows features and assigned teams
 */

import * as vscode from 'vscode';
import { AgentManager, Agent } from '@ai-team/core';

type TreeNode = FeatureItem | FeatureAgentItem | InfoItem;

export class FeaturesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
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
      // Get all unique features from agents
      const agents = this.agentManager.getAllAgents();
      const featuresSet = new Set<string>();

      for (const agent of agents) {
        if (agent.features) {
          agent.features.forEach(f => featuresSet.add(f));
        }
      }

      if (featuresSet.size === 0) {
        return [new InfoItem('No features assigned yet')];
      }

      return Array.from(featuresSet).map(f => new FeatureItem(f, this.agentManager));
    }

    if (element instanceof FeatureItem) {
      // Show agents assigned to this feature
      const agents = this.agentManager.getAgentsByFeature(element.featureId);
      return agents.map(a => new FeatureAgentItem(a));
    }

    return [];
  }
}

class FeatureItem extends vscode.TreeItem {
  featureId: string;

  constructor(featureId: string, private agentManager: AgentManager) {
    super(featureId, vscode.TreeItemCollapsibleState.Collapsed);

    this.featureId = featureId;
    
    const agentCount = agentManager.getAgentsByFeature(featureId).length;
    this.description = `${agentCount} team member${agentCount !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'feature';
  }
}

class FeatureAgentItem extends vscode.TreeItem {
  constructor(agent: Agent) {
    super(agent.name, vscode.TreeItemCollapsibleState.None);

    this.description = agent.role;
    this.iconPath = new vscode.ThemeIcon('person');
    this.contextValue = 'feature-agent';

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

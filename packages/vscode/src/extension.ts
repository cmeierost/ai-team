/**
 * VS Code Extension Entry Point
 */

import * as vscode from 'vscode';
import { AgentManager, SkillManager, TeamGraphBuilder, ChatManager } from '@ai-team/core';
import { TeamTreeProvider } from './views/teamTreeProvider';
import { FeaturesTreeProvider } from './views/featuresTreeProvider';
import { TeamGraphPanel } from './panels/teamGraphPanel';

let agentManager: AgentManager;
let skillManager: SkillManager;
let chatManager: ChatManager;
let teamTreeProvider: TeamTreeProvider;
let featuresTreeProvider: FeaturesTreeProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log('AI Team extension activated');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('AI Team requires a workspace to be open');
    return;
  }

  // Initialize managers
  agentManager = new AgentManager(workspaceRoot);
  skillManager = new SkillManager(workspaceRoot);
  chatManager = new ChatManager(workspaceRoot);

  try {
    await agentManager.initialize();
    await skillManager.initialize();
  } catch (error) {
    console.error('Failed to initialize AI Team:', error);
  }

  // Register tree providers
  teamTreeProvider = new TeamTreeProvider(agentManager);
  featuresTreeProvider = new FeaturesTreeProvider(agentManager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ai-team.teamView', teamTreeProvider),
    vscode.window.registerTreeDataProvider('ai-team.featuresView', featuresTreeProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ai-team.showTeamGraph', () => {
      TeamGraphPanel.createOrShow(context.extensionUri, agentManager);
    }),

    vscode.commands.registerCommand('ai-team.listAgents', async () => {
      const agents = agentManager.getAllAgents();
      const items = agents.map(a => ({
        label: a.name,
        description: a.role,
        detail: `Reports to: ${a.reportsTo || 'None'}`,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an agent to view details',
      });

      if (selected) {
        vscode.window.showInformationMessage(`Selected: ${selected.label}`);
      }
    }),

    vscode.commands.registerCommand('ai-team.createAgent', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Agent name',
        placeHolder: 'e.g., Senior Developer',
      });

      if (!name) return;

      const role = await vscode.window.showInputBox({
        prompt: 'Role/skill name',
        placeHolder: 'e.g., senior-developer',
      });

      if (!role) return;

      const contextLevel = await vscode.window.showQuickPick(
        ['task', 'module', 'feature', 'repository', 'organization'],
        { placeHolder: 'Select context level' }
      );

      if (!contextLevel) return;

      try {
        const agent = await agentManager.createAgent({
          name,
          role,
          contextLevel: contextLevel as any,
        });

        vscode.window.showInformationMessage(`Created agent: ${agent.name}`);
        teamTreeProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create agent: ${error}`);
      }
    }),

    vscode.commands.registerCommand('ai-team.chatWithAgent', async (agentItem?: any) => {
      let agentId: string | undefined;

      if (agentItem?.agentId) {
        agentId = agentItem.agentId;
      } else {
        // Show quick pick
        const agents = agentManager.getAllAgents();
        const items = agents.map(a => ({
          label: a.name,
          description: a.role,
          agentId: a.id,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select an agent to chat with',
        });

        agentId = selected?.agentId;
      }

      if (!agentId) return;

      const agent = agentManager.getAgent(agentId);
      if (!agent) return;

      // Open chat interface (placeholder - would open webview)
      const message = await vscode.window.showInputBox({
        prompt: `Chat with ${agent.name}`,
        placeHolder: 'Type your message...',
      });

      if (message) {
        const chatMessage = {
          timestamp: new Date().toISOString(),
          from: 'human' as const,
          content: message,
        };

        await chatManager.appendMessage(agentId, chatMessage);
        await agentManager.recordInteraction(agentId);

        vscode.window.showInformationMessage(
          `Message sent to ${agent.name}. (LLM integration pending)`
        );
      }
    }),

    vscode.commands.registerCommand('ai-team.initWorkspace', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Initialize AI Team in this workspace?',
        'Yes',
        'No'
      );

      if (confirm !== 'Yes') return;

      try {
        const { ensureAiTeamDirectory } = await import('@ai-team/core');
        await ensureAiTeamDirectory(workspaceRoot);

        await agentManager.initialize();
        await skillManager.initialize();

        teamTreeProvider.refresh();
        featuresTreeProvider.refresh();

        vscode.window.showInformationMessage('AI Team initialized successfully!');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to initialize: ${error}`);
      }
    })
  );

  // File watcher for agent changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/.ai-team/agents/*.md');
  
  watcher.onDidCreate(() => {
    agentManager.loadAllAgents();
    teamTreeProvider.refresh();
  });

  watcher.onDidChange(() => {
    agentManager.loadAllAgents();
    teamTreeProvider.refresh();
  });

  watcher.onDidDelete(() => {
    agentManager.loadAllAgents();
    teamTreeProvider.refresh();
  });

  context.subscriptions.push(watcher);
}

export function deactivate() {
  // Cleanup
}

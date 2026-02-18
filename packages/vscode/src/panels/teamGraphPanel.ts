/**
 * Team Graph Panel - Webview for visualizing team structure
 */

import * as vscode from 'vscode';
import { AgentManager, TeamGraphBuilder, ViewMode } from '@ai-team/core';

export class TeamGraphPanel {
  public static currentPanel: TeamGraphPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, agentManager: AgentManager) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (TeamGraphPanel.currentPanel) {
      TeamGraphPanel.currentPanel._panel.reveal(column);
      TeamGraphPanel.currentPanel._update(agentManager);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'aiTeamGraph',
      'AI Team Graph',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    TeamGraphPanel.currentPanel = new TeamGraphPanel(panel, extensionUri, agentManager);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private agentManager: AgentManager
  ) {
    this._panel = panel;

    // Set the webview's initial html content
    this._update(agentManager);

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'selectAgent':
            this._handleAgentSelect(message.agentId);
            break;
          case 'changeView':
            this._handleViewChange(message.viewMode);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private _handleAgentSelect(agentId: string) {
    const agent = this.agentManager.getAgent(agentId);
    if (agent) {
      vscode.window.showInformationMessage(`Selected: ${agent.name}`);
      // Could open chat, show details, etc.
    }
  }

  private _handleViewChange(viewMode: ViewMode) {
    this._update(this.agentManager, viewMode);
  }

  private _update(agentManager: AgentManager, viewMode: ViewMode = 'hierarchy') {
    const graphBuilder = new TeamGraphBuilder(agentManager);
    const graphData = graphBuilder.buildGraph(viewMode);
    const layoutData = graphBuilder.calculateHierarchicalLayout(graphData);

    this._panel.webview.html = this._getHtmlForWebview(layoutData, viewMode);
  }

  private _getHtmlForWebview(graphData: any, viewMode: ViewMode) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Team Graph</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: var(--vscode-font-family);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    
    .controls {
      margin-bottom: 20px;
      display: flex;
      gap: 10px;
    }
    
    select, button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 12px;
      cursor: pointer;
      border-radius: 2px;
    }
    
    select:hover, button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    #graph {
      width: 100%;
      height: calc(100vh - 100px);
      position: relative;
      overflow: auto;
      border: 1px solid var(--vscode-panel-border);
    }
    
    svg {
      min-width: 100%;
      min-height: 100%;
    }
    
    .node {
      cursor: pointer;
    }
    
    .node rect {
      fill: var(--vscode-button-background);
      stroke: var(--vscode-button-border);
      stroke-width: 2;
    }
    
    .node:hover rect {
      fill: var(--vscode-button-hoverBackground);
    }
    
    .node text {
      fill: var(--vscode-button-foreground);
      font-size: 14px;
      pointer-events: none;
    }
    
    .edge {
      stroke: var(--vscode-panel-border);
      stroke-width: 2;
      fill: none;
      marker-end: url(#arrowhead);
    }
    
    .label {
      font-size: 12px;
      fill: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="controls">
    <select id="viewMode">
      <option value="hierarchy" ${viewMode === 'hierarchy' ? 'selected' : ''}>Hierarchy</option>
      <option value="features" ${viewMode === 'features' ? 'selected' : ''}>Features</option>
      <option value="expertise" ${viewMode === 'expertise' ? 'selected' : ''}>Expertise</option>
      <option value="matrix" ${viewMode === 'matrix' ? 'selected' : ''}>Matrix</option>
    </select>
    <button id="exportBtn">Export JSON</button>
  </div>
  
  <div id="graph"></div>
  
  <script>
    const vscode = acquireVsCodeApi();
    const graphData = ${JSON.stringify(graphData)};
    
    document.getElementById('viewMode').addEventListener('change', (e) => {
      vscode.postMessage({
        command: 'changeView',
        viewMode: e.target.value
      });
    });
    
    document.getElementById('exportBtn').addEventListener('click', () => {
      const dataStr = JSON.stringify(graphData, null, 2);
      const blob = new Blob([dataStr], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ai-team-graph.json';
      a.click();
    });
    
    // Simple SVG rendering
    function renderGraph() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '1200');
      svg.setAttribute('height', '800');
      
      // Add arrowhead marker
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '10');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0 0, 10 3, 0 6');
      polygon.setAttribute('fill', 'var(--vscode-panel-border)');
      marker.appendChild(polygon);
      defs.appendChild(marker);
      svg.appendChild(defs);
      
      // Render edges
      graphData.edges.forEach(edge => {
        const source = graphData.nodes.find(n => n.id === edge.source);
        const target = graphData.nodes.find(n => n.id === edge.target);
        
        if (source && target && source.position && target.position) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const x1 = source.position.x + 100;
          const y1 = source.position.y + 30;
          const x2 = target.position.x + 100;
          const y2 = target.position.y;
          
          line.setAttribute('d', \`M \${x1} \${y1} L \${x2} \${y2}\`);
          line.setAttribute('class', 'edge');
          svg.appendChild(line);
        }
      });
      
      // Render nodes
      graphData.nodes.forEach(node => {
        if (!node.position) return;
        
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'node');
        g.setAttribute('data-id', node.id);
        
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', node.position.x);
        rect.setAttribute('y', node.position.y);
        rect.setAttribute('width', '200');
        rect.setAttribute('height', '60');
        rect.setAttribute('rx', '4');
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', node.position.x + 100);
        text.setAttribute('y', node.position.y + 25);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = node.data.label;
        
        const roleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        roleText.setAttribute('x', node.position.x + 100);
        roleText.setAttribute('y', node.position.y + 45);
        roleText.setAttribute('text-anchor', 'middle');
        roleText.setAttribute('class', 'label');
        roleText.textContent = node.data.role || '';
        
        g.appendChild(rect);
        g.appendChild(text);
        g.appendChild(roleText);
        
        g.addEventListener('click', () => {
          vscode.postMessage({
            command: 'selectAgent',
            agentId: node.id
          });
        });
        
        svg.appendChild(g);
      });
      
      document.getElementById('graph').innerHTML = '';
      document.getElementById('graph').appendChild(svg);
    }
    
    renderGraph();
  </script>
</body>
</html>`;
  }

  public dispose() {
    TeamGraphPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

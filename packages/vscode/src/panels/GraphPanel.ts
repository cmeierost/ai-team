/**
 * Graph Panel - webview showing team graph visualization
 */

import * as vscode from 'vscode';
import { AgentManager, TeamGraphBuilder } from '@ai-team/core';

export class GraphPanel {
  public static currentPanel: GraphPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private agentManager: AgentManager
  ) {
    this._panel = panel;

    // Set the webview's HTML content
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, extensionUri);

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'refresh':
            this._update();
            return;
        }
      },
      null,
      this._disposables
    );

    // Initial update
    this._update();
  }

  public static createOrShow(extensionUri: vscode.Uri, agentManager: AgentManager) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (GraphPanel.currentPanel) {
      GraphPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'aiTeamGraph',
      'AI Team Graph',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      }
    );

    GraphPanel.currentPanel = new GraphPanel(panel, extensionUri, agentManager);
  }

  public dispose() {
    GraphPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _update() {
    const graphBuilder = new TeamGraphBuilder(this.agentManager);
    const graphData = graphBuilder.buildGraph('hierarchy');
    const layoutData = graphBuilder.calculateHierarchicalLayout(graphData);

    this._panel.webview.postMessage({
      command: 'updateGraph',
      data: layoutData,
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
    
    #graph {
      width: 100%;
      height: calc(100vh - 80px);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    
    .controls {
      margin-bottom: 10px;
    }
    
    button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      cursor: pointer;
      border-radius: 2px;
      margin-right: 8px;
    }
    
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    
    .node {
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .node:hover {
      opacity: 0.8;
    }
    
    .node-rect {
      fill: var(--vscode-button-background);
      stroke: var(--vscode-button-border);
      stroke-width: 2;
    }
    
    .node-text {
      fill: var(--vscode-button-foreground);
      font-size: 12px;
      text-anchor: middle;
    }
    
    .edge {
      stroke: var(--vscode-panel-border);
      stroke-width: 2;
      fill: none;
      marker-end: url(#arrowhead);
    }
  </style>
</head>
<body>
  <div class="controls">
    <button onclick="refresh()">Refresh</button>
    <button onclick="resetZoom()">Reset Zoom</button>
  </div>
  
  <svg id="graph"></svg>
  
  <script>
    const vscode = acquireVsCodeApi();
    let graphData = null;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    
    window.addEventListener('message', event => {
      const message = event.data;
      
      if (message.command === 'updateGraph') {
        graphData = message.data;
        renderGraph();
      }
    });
    
    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
    
    function resetZoom() {
      zoom = 1;
      panX = 0;
      panY = 0;
      renderGraph();
    }
    
    function renderGraph() {
      if (!graphData) return;
      
      const svg = document.getElementById('graph');
      const { nodes, edges } = graphData;
      
      // Clear existing content
      svg.innerHTML = '';
      
      // Add arrowhead marker
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = \`
        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
          <polygon points="0 0, 10 3, 0 6" fill="var(--vscode-panel-border)" />
        </marker>
      \`;
      svg.appendChild(defs);
      
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', \`translate(\${panX}, \${panY}) scale(\${zoom})\`);
      
      // Draw edges
      edges.forEach(edge => {
        const source = nodes.find(n => n.id === edge.source);
        const target = nodes.find(n => n.id === edge.target);
        
        if (source?.position && target?.position) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('class', 'edge');
          line.setAttribute('x1', source.position.x + 100);
          line.setAttribute('y1', source.position.y + 30);
          line.setAttribute('x2', target.position.x + 100);
          line.setAttribute('y2', target.position.y);
          g.appendChild(line);
        }
      });
      
      // Draw nodes
      nodes.forEach(node => {
        if (!node.position) return;
        
        const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nodeGroup.setAttribute('class', 'node');
        nodeGroup.setAttribute('transform', \`translate(\${node.position.x}, \${node.position.y})\`);
        
        // Rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'node-rect');
        rect.setAttribute('width', '200');
        rect.setAttribute('height', '60');
        rect.setAttribute('rx', '4');
        nodeGroup.appendChild(rect);
        
        // Name
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'node-text');
        text.setAttribute('x', '100');
        text.setAttribute('y', '25');
        text.textContent = node.data.label;
        nodeGroup.appendChild(text);
        
        // Role
        const roleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        roleText.setAttribute('class', 'node-text');
        roleText.setAttribute('x', '100');
        roleText.setAttribute('y', '45');
        roleText.setAttribute('opacity', '0.7');
        roleText.setAttribute('font-size', '10');
        roleText.textContent = node.data.role || '';
        nodeGroup.appendChild(roleText);
        
        g.appendChild(nodeGroup);
      });
      
      svg.appendChild(g);
      
      // Auto-fit view
      if (nodes.length > 0 && nodes[0].position) {
        const bbox = g.getBBox();
        const svgRect = svg.getBoundingClientRect();
        const scale = Math.min(
          svgRect.width / (bbox.width + 40),
          svgRect.height / (bbox.height + 40),
          1
        );
        zoom = scale;
        panX = (svgRect.width - bbox.width * scale) / 2 - bbox.x * scale;
        panY = 20;
        g.setAttribute('transform', \`translate(\${panX}, \${panY}) scale(\${zoom})\`);
      }
    }
    
    // Request initial data
    refresh();
  </script>
</body>
</html>`;
  }
}

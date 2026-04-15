import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioMcpSectionProps {
  tools: string[];
}

function groupMcpTools(tools: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const tool of tools) {
    // Group by prefix: mcp_microsoft_pla → playwright, mcp_io_github_chr → chrome, etc.
    let group = 'other';
    if (tool.startsWith('mcp_microsoft_pla_')) group = 'playwright';
    else if (tool.startsWith('mcp_io_github_chr_')) group = 'chrome-devtools';
    else if (tool.startsWith('mcp_microsoft_')) group = 'microsoft';
    else if (tool.startsWith('mcp_io_github_')) group = 'github';
    else if (tool.startsWith('mcp_')) group = tool.split('_').slice(0, 3).join('_');

    if (!map.has(group)) map.set(group, []);
    map.get(group)?.push(tool);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function PortfolioMcpSection({ tools }: Readonly<PortfolioMcpSectionProps>) {
  const mcpTools = tools.filter((t) => t.startsWith('mcp_'));
  const otherTools = tools.filter((t) => !t.startsWith('mcp_'));
  const groups = groupMcpTools(mcpTools);

  return (
    <PortfolioSectionCard title="MCP Tools" icon="🔌">
      {tools.length === 0 ? (
        <p className="text-muted">No MCP tools registered.</p>
      ) : (
        <div className="tool-groups">
          {mcpTools.length > 0 &&
            [...groups.entries()].map(([group, groupTools]) => (
              <div key={group} className="tool-group">
                <div className="tool-group-header">
                  <span className="tool-group-name">{group}</span>
                </div>
                <div className="tool-active-chips">
                  {groupTools.map((tool) => (
                    <span key={tool} className="tool-tag tool-tag-active" title={tool}>
                      {tool.replace(/^mcp_[^_]+_[^_]+_/, '')}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          {otherTools.length > 0 && (
            <div className="tool-group">
              <div className="tool-group-header">
                <span className="tool-group-name">other</span>
              </div>
              <div className="tool-active-chips">
                {otherTools.map((tool) => (
                  <span key={tool} className="tool-tag tool-tag-active" title={tool}>
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </PortfolioSectionCard>
  );
}

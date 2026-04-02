# MCP (Model Context Protocol)

**MCP – Model Context Protocol** is an open protocol for connecting models to external tools and data sources in a consistent way.

## 1. Core Ideas

- **Servers** expose tools and resources (files, APIs, databases).
- **Clients** (editors, apps) host models and communicate with MCP servers.
- **Resources** are read-only views of data.
- **Tools** are callable operations with schemas.

## 2. Why MCP Matters for ai-team

- ai-team already treats tools and context as first-class concepts.
- MCP provides a standard way for external clients (VS Code, Claude Desktop, Cursor) to call ai-team’s tools.
- Using MCP means:
  - Less custom integration work per editor.
  - Clear, auditable contracts for what ai-team exposes.

## 3. Integration Approach

- ai-team can implement an MCP server that:
  - Reads `.ai-team/` configs to know which agents, skills, and tools exist.
  - Exposes those tools/resources to any MCP-compatible client.
- The same core logic in `@ai-team/core` powers both:
  - Local CLI/VS Code workflows.
  - Remote calls via MCP.

MCP is not required for ai-team to function, but it is the preferred way to integrate with rich external UIs and other assistants.

## Further Reading

- Model Context Protocol – Specification and docs: https://modelcontextprotocol.io
- Anthropic – MCP in Claude Desktop: https://docs.anthropic.com/en/docs/model-context-protocol
- GitHub – Example MCP servers and tooling: https://github.com/topics/model-context-protocol

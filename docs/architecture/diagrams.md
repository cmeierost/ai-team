# Architecture Diagrams

These diagrams are the visual companion to [ARCHITECTURE.md](../../ARCHITECTURE.md). They focus on package responsibilities and the main runtime flows in the current March 2026 architecture.

## Package and transport map

This diagram shows what each package does and how the main runtime layers connect.

```mermaid
flowchart LR
  subgraph LocalAdapters[Local adapters]
    CLI[@ai-team/cli\nTerminal UX]
    VSC[@ai-team/vscode\nIDE-native review and open-file UX]
  end

  subgraph RemoteAdapters[Remote/browser adapters]
    WEB[@ai-team/web\nDashboard, portfolio, chat, sessions, tasks]
    HTTPCLIENT[@ai-team/api-client-http\nBrowser-safe REST + WebSocket client]
    APISERVER[@ai-team/api-server\nREST and WebSocket transport]
  end

  subgraph SharedRuntime[Shared runtime]
    LOCALCLIENT[@ai-team/api-client\nLocal typed client façade]
    IDE[@ai-team/ide-interface\nIDE bridge contracts]
    SERVICE[@ai-team/service\nMediator, orchestration, runtime events]
    CORE[@ai-team/core\nUI-free domain logic]
    ACCESS[@ai-team/access\nFile-path access rights policy engine]
  end

  STATE[.ai-team/*\nRuntime state]
  PROVIDERS[LLM / provider APIs]

  CLI --> LOCALCLIENT
  WEB --> HTTPCLIENT
  HTTPCLIENT -->|REST + WS| APISERVER
  APISERVER --> LOCALCLIENT
  LOCALCLIENT --> SERVICE
  SERVICE --> CORE
  CORE --> ACCESS
  CORE --> STATE
  SERVICE --> STATE
  SERVICE --> PROVIDERS

  CLI -. proposal/open-file bridge .-> IDE
  APISERVER -. proposal/open-file bridge .-> IDE
  IDE --> VSC
```

## Local, remote, and IDE execution paths

This diagram makes the three main runtime paths explicit.

```mermaid
flowchart TD
  START([User action]) --> CHOICE{Which surface?}

  CHOICE -->|CLI| CLI[@ai-team/cli]
  CHOICE -->|Browser| WEB[@ai-team/web]
  CHOICE -->|IDE review/open-file| IDEBRIDGE[@ai-team/ide-interface]

  CLI --> LOCALCLIENT[@ai-team/api-client]

  WEB --> HTTPCLIENT[@ai-team/api-client-http]
  HTTPCLIENT --> APISERVER[@ai-team/api-server]
  APISERVER --> LOCALCLIENT

  IDEBRIDGE --> VSC[@ai-team/vscode IDE-local server]

  LOCALCLIENT --> SERVICE[@ai-team/service]
  SERVICE --> CORE[@ai-team/core]
  CORE --> STATE[.ai-team/*]
  SERVICE --> PROVIDERS[LLM / provider APIs]
```

## Chat orchestration flow

This is the high-level control flow for the shared chat pipeline inside `@ai-team/service`.

```mermaid
flowchart TD
  CHATCMD[chatCommand\npackages/service/src/commands/chat/index.ts]
  ORCH[ChatOrchestrator.run\npackages/service/src/orchestrator/chat-orchestrator.ts]
  SENDTURN[sendTurn\npackages/service/src/orchestrator/send-turn.ts]
  HANDOFF[handoff.ts\ncontext switch + briefing]
  SESSION[Session + workflow state]
  TOOLS[Local tools + MCP tools]
  MODEL[LlmService / provider APIs]

  CHATCMD --> ORCH
  ORCH -->|slash command| ORCH
  ORCH -->|NL forward| HANDOFF
  ORCH -->|regular turn| SENDTURN
  SENDTURN --> SESSION
  SENDTURN --> TOOLS
  SENDTURN --> MODEL
  SENDTURN -->|handoff result| HANDOFF
  HANDOFF --> SESSION
  HANDOFF --> ORCH
```

## Mediator event bridge

This diagram shows how service runtime activity becomes adapter-facing stream events.

```mermaid
sequenceDiagram
  participant Surface as CLI / API server
  participant Service as CoreAiTeamService.stream()
  participant Invoke as CoreAiTeamService.invoke()
  participant Chat as chatCommand()
  participant Orch as ChatOrchestrator
  participant Turn as sendTurn()

  Surface->>Service: stream(MediatorRequest)
  Service-->>Surface: started
  Service->>Invoke: invoke(request, emitRuntimeEvent)
  Invoke->>Chat: chatCommand(...)
  Chat->>Orch: run(message)
  Orch->>Turn: sendTurn(...)
  Turn-->>Invoke: runtime events via hooks.emit
  Invoke-->>Service: runtime events queued
  Service-->>Surface: status / log / token / tool / question / handoff
  Invoke-->>Service: result or error
  Service-->>Surface: result
  Service-->>Surface: done or error
```

## VS Code proposal review loop

The VS Code extension is not a second service layer; it is the IDE-native review endpoint for proposal/open-file workflows.

```mermaid
flowchart LR
  SERVICE[@ai-team/service\ncode_edit_proposal event] --> STORE[ProposalStore]
  STORE --> CLI[@ai-team/cli]
  STORE --> APISERVER[@ai-team/api-server]

  CLI --> IDE[@ai-team/ide-interface]
  APISERVER --> IDE
  IDE --> VSC[@ai-team/vscode\nIDE-local server]
  VSC --> DIFF[Diff editor + CodeLens]
  VSC --> PENDING[Pending Changes view/panel]
  DIFF --> ACK[Ack Keep / Undo]
  PENDING --> ACK
  ACK --> IDE
```

## File-system access evaluation flow

This diagram shows how global file-tree defaults and per-agent `.access` rules combine into effective rights.

```mermaid
flowchart TD
  REQUEST[Path + right request\nread/write/create/delete/list] --> ENGINE[@ai-team/access AccessEngine]

  GLOBAL[.ai-team/config.json\nfileTree.read/write/create/delete paths] --> ENGINE
  AGENTCFG[.ai-team/agents/*.agent.yml\nidentity/tools/delegation metadata] --> ADAPTER[core access adapter]
  AGENTACCESS[.ai-team/agents/<agent-id>.access\nper-agent path policies] --> ADAPTER
  ADAPTER --> ENGINE

  ENGINE --> INHERIT[Rights inheritance\nwrite => read + list\nread => list]
  INHERIT --> PRECEDENCE[Explicit deny precedence]
  PRECEDENCE --> VERDICT[Allowed or denied verdict\nwith path-level rationale]

  VERDICT --> CLI[@ai-team/cli files/access views]
  VERDICT --> SERVICE[@ai-team/service commands]
  VERDICT --> API[@ai-team/api-server routes]
  VERDICT --> WEB[@ai-team/web file tree]
```

## Notes

- `@ai-team/api-client` and `@ai-team/api-client-http` are intentionally different client surfaces.
- `@ai-team/service` is the shared orchestration boundary.
- `@ai-team/vscode` is best understood as an IDE adapter reached through `@ai-team/ide-interface`, not as a peer orchestrator.

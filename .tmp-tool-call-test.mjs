import {
  AgentManager,
  LlmService,
  executeAgentTool,
  loadSkill,
} from "./packages/core/dist/index.js";

const workspaceRoot = process.cwd();
const agentManager = new AgentManager(workspaceRoot);
await agentManager.initialize();
const agent = agentManager.resolveAgent("maya")[0];
if (!agent) {
  console.error("No agents found");
  process.exit(1);
}
let skill;
try { skill = await loadSkill(agent.skillPath); } catch {}

const llm = new LlmService(workspaceRoot);
await llm.initializeForChat(agent, skill);

const toolDefinitions = [{
  name: "semantic_search",
  description: "Search codebase semantically",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  },
}];

const result = await llm.chatWithTools(
  agent,
  [{ role: "user", content: "You must call exactly one tool now. Use semantic_search with query 'provider models refresh'. If you do not call a tool, your answer is invalid." }],
  toolDefinitions,
  async (toolCall) => {
    const execution = await executeAgentTool({
      toolName: toolCall.toolName,
      params: toolCall.args,
      context: {
        agent,
        workspaceRoot,
        currentFiles: ["packages/cli/src/commands/models.ts"],
      },
    });

    return {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      result: execution.ok ? execution.result : (execution.error || "Tool execution failed"),
      isError: !execution.ok,
    };
  },
  undefined,
  skill,
  agentManager.getAllAgents(),
);

console.log("\n=== TOOL CALLING RESULT ===\n");
console.log(result.text);
console.log("\nTool call count:", result.toolResults.length);
for (const call of result.toolResults) {
  console.log(`- ${call.toolName} (error=${call.isError ? "yes" : "no"})`);
}

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {AgentManager, SkillManager, ChatManager } from '@ai-team/core';

const app = express();
const PORT = 3002;

// Get workspace root - navigate up from packages/api to project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../..');

// Initialize managers
const agentManager = new AgentManager(workspaceRoot);
const skillManager = new SkillManager(workspaceRoot);
const chatManager = new ChatManager(workspaceRoot);

// Middleware
app.use(cors());
app.use(express.json());

// Initialize on startup
await agentManager.initialize();

// API Routes

// GET /api/agents - List all agents
app.get('/api/agents', (req, res) => {
  try {
    const agents = agentManager.getAllAgents();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/agents/:id - Get agent by ID
app.get('/api/agents/:id', (req, res) => {
  try {
    const agent = agentManager.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/skills - List all skills
app.get('/api/skills', async (req, res) => {
  try {
    const skills = await skillManager.getAllSkills();
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/chat/:agentId - Get chat history
app.get('/api/chat/:agentId', async (req, res) => {
  try {
    const messages = await chatManager.loadChatHistory(req.params.agentId);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/chat/:agentId - Send message
app.post('/api/chat/:agentId', async (req, res) => {
  try {
    const { content } = req.body;
    const message = {
      from: 'human',
      content,
      timestamp: new Date().toISOString(),
    };
    
    await chatManager.appendMessage(req.params.agentId, message);
    
    // TODO: Get actual LLM response
    const agent = agentManager.getAgent(req.params.agentId);
    const response = {
      from: req.params.agentId,
      content: `[${agent?.name || req.params.agentId}] This is a placeholder response. LLM integration coming soon!`,
      timestamp: new Date().toISOString(),
    };
    
    await chatManager.appendMessage(req.params.agentId, response);
    
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', workspace: workspaceRoot });
});

app.listen(PORT, () => {
  console.log(`AI Team API server running at http://localhost:${PORT}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Loaded ${agentManager.getAllAgents().length} agents`);
});

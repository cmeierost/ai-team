import { Router } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import express from 'express';
import {
  AgentManager,
  AgentSchema,
  ContextManager,
  LlmService,
  listCachedWorkspaceFiles,
  loadTeamConfig,
  parseMarkdownSections,
  replaceOrAppendMarkdownSection,
} from '@ai-team/core';
import { generateIntroduction } from '@ai-team/service';

/**
 * @openapi
 * components:
 *   schemas:
 *     Agent:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         role:
 *           type: string
 *         providerId:
 *           type: string
 *         modelId:
 *           type: string
 */

export function createAgentsRouter(client: AiTeamClient, agentManager: AgentManager): Router {
  const router = express.Router();

  /**
   * @openapi
   * /api/agents:
   *   get:
   *     tags: [Agents]
   *     summary: List all agents
   *     description: Retrieve a list of all team members/agents
   *     responses:
   *       200:
   *         description: List of agents
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Agent'
   */
  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const agents = await client.listEmployees({});
      res.json(agents);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/search:
   *   get:
   *     tags: [Agents]
   *     summary: Get a specific agent
   *     description: Retrieve details of a specific team member/agent by ID
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     responses:
   *       200:
   *         description: Agent details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Agent'
   *       404:
   *         description: Agent not found
   */
  router.get('/:id', async (req: any, res: any, next: any) => {
    try {
      const agents = await client.resolveEmployees(req.params.id);
      if (agents.length === 0) {
        return res.status(404).json({
          error: 'Agent not found',
          details: `Agent with ID ${req.params.id} does not exist`,
        });
      }
      res.json(agents[0]);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/search:
   *   get:
   *     tags: [Agents]
   *     summary: Search agents
   *     description: Search for agents with fuzzy matching and filtering
   *     parameters:
   *       - name: q
   *         in: query
   *         schema:
   *           type: string
   *         description: Search query (name, role, specializations, features, etc.)
   *       - name: role
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by role (can be repeated)
   *       - name: type
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by role type (executive, team-lead, etc.)
   *       - name: status
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by status (available, busy, etc.)
   *       - name: feature
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by feature (can be repeated)
   *       - name: specialization
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by specialization (can be repeated)
   *       - name: tool
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by tool (can be repeated)
   *       - name: reportsTo
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by manager ID
   *       - name: contextLevel
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by context level (task, module, feature, repository, organization)
   *     responses:
   *       200:
   *         description: Search results with scores
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       agent:
   *                         $ref: '#/components/schemas/Agent'
   *                       score:
   *                         type: number
   *                       matches:
   *                         type: array
   *                         items:
   *                           type: string
   *                 totalCount:
   *                   type: number
   */
  router.get('/search', async (req: any, res: any, next: any) => {
    try {
      // Parse query parameters (support arrays)
      const parseArrayParam = (param: any): string[] | undefined => {
        if (!param) return undefined;
        return Array.isArray(param) ? param : [param];
      };

      const searchRequest: any = {
        query: req.query.q,
        role: parseArrayParam(req.query.role),
        type: parseArrayParam(req.query.type),
        status: parseArrayParam(req.query.status),
        feature: parseArrayParam(req.query.feature),
        specialization: parseArrayParam(req.query.specialization),
        tool: parseArrayParam(req.query.tool),
        reportsTo: req.query.reportsTo,
        contextLevel: parseArrayParam(req.query.contextLevel),
      };

      // Remove undefined values
      Object.keys(searchRequest).forEach(key => {
        if (searchRequest[key] === undefined) {
          delete searchRequest[key];
        }
      });

      const response = await client.searchAgents(searchRequest);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/{id}:
   *   get:
   *     tags: [Agents]
   *     summary: Get a specific agent
   *     description: Retrieve details of a specific team member/agent by ID
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     responses:
   *       200:
   *         description: Agent details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Agent'
   *       404:
   *         description: Agent not found
   */
  router.get('/:id', async (req: any, res: any, next: any) => {
    try {
      const agents = await client.resolveEmployees(req.params.id);
      if (agents.length === 0) {
        return res.status(404).json({
          error: 'Agent not found',
          details: `Agent with ID ${req.params.id} does not exist`,
        });
      }
      res.json(agents[0]);
    } catch (error) {
      next(error);
    }
  });

  // ==========================================================================
  // Frontmatter & Markdown Section Endpoints
  // ==========================================================================

  /** Helper: resolve agent by fuzzy query (id / role / name), return 404 if not found */
  async function resolveAgentOrFail(query: string, res: any): Promise<ReturnType<AgentManager['getAgent']> | null> {
    const matches = agentManager.resolveAgent(query);
    if (matches.length === 0) {
      res.status(404).json({ error: 'Agent not found', details: `No agent matching "${query}"` });
      return null;
    }
    return matches[0];
  }

  /**
   * @openapi
   * /api/agents/{id}/frontmatter:
   *   get:
   *     tags: [Agents]
   *     summary: Get agent frontmatter as JSON
   *     description: Returns the full agent object (frontmatter fields + computed fields) as JSON
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Agent frontmatter as JSON
   *       404:
   *         description: Agent not found
   */
  router.get('/:id/frontmatter', async (req: any, res: any, next: any) => {
    try {
      const agent = await resolveAgentOrFail(req.params.id, res);
      if (!agent) return;
      res.json(agent);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/{id}/frontmatter:
   *   patch:
   *     tags: [Agents]
   *     summary: Update agent frontmatter fields
   *     description: Partially update agent frontmatter (YAML) fields. Accepts any subset of AgentConfig fields.
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: Updated agent
   *       400:
   *         description: Invalid request body
   *       404:
   *         description: Agent not found
   */
  router.patch('/:id/frontmatter', async (req: any, res: any, next: any) => {
    try {
      const existing = await resolveAgentOrFail(req.params.id, res);
      if (!existing) return;

      // Validate body as partial AgentSchema
      const parsed = AgentSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid frontmatter',
          details: parsed.error.issues,
        });
      }

      const updated = await agentManager.updateAgent(existing.id, parsed.data);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/{id}/sections:
   *   get:
   *     tags: [Agents]
   *     summary: Get agent markdown body parsed into sections
   *     description: |
   *       Returns the agent's markdown body split into ordered sections by ## headings.
   *       Each section has a `heading` (empty string for preamble before first ##) and `content`.
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Ordered array of markdown sections
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   heading:
   *                     type: string
   *                   content:
   *                     type: string
   *       404:
   *         description: Agent not found
   */
  router.get('/:id/sections', async (req: any, res: any, next: any) => {
    try {
      const agent = await resolveAgentOrFail(req.params.id, res);
      if (!agent) return;
      const sections = parseMarkdownSections(agent.markdown || '');
      res.json(sections);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/{id}/sections/{heading}:
   *   patch:
   *     tags: [Agents]
   *     summary: Update or create a markdown section by heading title
   *     description: |
   *       Replaces the content of a specific ## section identified by heading title.
   *       If the heading does not exist, a new section is appended at the end of the document.
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *       - name: heading
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: The heading title (without the ## prefix)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               content:
   *                 type: string
   *                 description: New section body content
   *     responses:
   *       200:
   *         description: Updated sections array
   *       400:
   *         description: Invalid request body
   *       404:
   *         description: Agent not found
   */
  const SectionUpdateSchema = { safeParse: (body: any) => {
    if (body && typeof body.content === 'string') return { success: true as const, data: { content: body.content as string } };
    return { success: false as const, error: { issues: [{ message: 'content must be a string' }] } };
  }};

  router.patch('/:id/sections/:heading', async (req: any, res: any, next: any) => {
    try {
      const agent = await resolveAgentOrFail(req.params.id, res);
      if (!agent) return;

      const parsed = SectionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: 'Body must contain { "content": "..." }',
        });
      }

      const heading = decodeURIComponent(req.params.heading);
      const newMarkdown = replaceOrAppendMarkdownSection(
        agent.markdown || '',
        heading,
        parsed.data.content,
      );

      const updated = await agentManager.updateAgent(agent.id, { markdown: newMarkdown });
      const sections = parseMarkdownSections(updated.markdown || '');
      res.json(sections);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/{id}/markdown:
   *   get:
   *     tags: [Agents]
   *     summary: Get the raw markdown body of an agent
   *     description: Returns the full markdown body (without YAML frontmatter) as plain text
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Raw markdown body
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   *       404:
   *         description: Agent not found
   */
  router.get('/:id/markdown', async (req: any, res: any, next: any) => {
    try {
      const agent = await resolveAgentOrFail(req.params.id, res);
      if (!agent) return;
      res.type('text/plain').send(agent.markdown || '');
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/{id}/markdown:
   *   put:
   *     tags: [Agents]
   *     summary: Replace the entire markdown body of an agent
   *     description: |
   *       Replaces the full markdown body with the provided content.
   *       Use this when you want to write the raw markdown yourself instead of using section-based updates.
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [markdown]
   *             properties:
   *               markdown:
   *                 type: string
   *                 description: Full markdown body content
   *     responses:
   *       200:
   *         description: Updated agent
   *       400:
   *         description: Invalid request body
   *       404:
   *         description: Agent not found
   */
  const MarkdownUpdateSchema = { safeParse: (body: any) => {
    if (body && typeof body.markdown === 'string') return { success: true as const, data: { markdown: body.markdown as string } };
    return { success: false as const, error: { issues: [{ message: 'markdown must be a string' }] } };
  }};

  router.put('/:id/markdown', async (req: any, res: any, next: any) => {
    try {
      const agent = await resolveAgentOrFail(req.params.id, res);
      if (!agent) return;

      const parsed = MarkdownUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: 'Body must contain { "markdown": "..." }',
        });
      }

      const updated = await agentManager.updateAgent(agent.id, { markdown: parsed.data.markdown });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // ==========================================================================
  // Agent file-tree endpoint (annotated with read / write permissions)
  // ==========================================================================

  /**
   * @openapi
   * /api/agents/{id}/files:
   *   get:
   *     tags: [Agents]
   *     summary: Get the workspace file list annotated with the agent's read/write permissions
   *     description: |
   *       Returns every file in the workspace that the agent can either read or write,
   *       together with boolean `readable` and `writable` flags per file.
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID, name or role (fuzzy-matched)
   *       - name: depth
   *         in: query
   *         schema:
   *           type: integer
   *           default: 6
   *         description: Max directory depth
   *       - name: all
   *         in: query
   *         schema:
   *           type: boolean
   *           default: false
   *         description: Include files with no read or write access
   *     responses:
   *       200:
   *         description: Annotated file list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 agent:
   *                   type: string
   *                 readPatterns:
   *                   type: array
   *                   items:
   *                     type: string
   *                 writePatterns:
   *                   type: array
   *                   items:
   *                     type: string
   *                 files:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       path:
   *                         type: string
   *                       readable:
   *                         type: boolean
   *                       writable:
   *                         type: boolean
   *       404:
   *         description: Agent not found
   */
  router.get('/:id/files', async (req: any, res: any, next: any) => {
    try {
      const agent = await resolveAgentOrFail(req.params.id, res);
      if (!agent) return;

      const maxDepth = req.query.depth ? Number.parseInt(req.query.depth, 10) : 6;
      const includeAll = req.query.all === 'true' || req.query.all === '1';

      // Build file tree respecting global allowPaths
      const config = await loadTeamConfig(agentManager.workspaceRoot);
      const allowPaths = Array.from(new Set([
        ...(config?.fileTree?.readPaths ?? []),
        ...(config?.fileTree?.writePaths ?? []),
        ...(config?.fileTree?.createPaths ?? []),
        ...(config?.fileTree?.deletePaths ?? []),
      ]));
      const entries = await listCachedWorkspaceFiles(agentManager.workspaceRoot, {
        maxDepth,
        allowPaths,
        filesOnly: true,
      });
      const allFiles = entries.map((entry) => entry.relativePath);

      // Annotate with permissions
      const ctx = ContextManager.fromConfig(agentManager.workspaceRoot, config?.fileTree);
      const annotated = ctx.getAnnotatedFiles(agent, allFiles);

      const files = includeAll
        ? annotated
        : annotated.filter(f => f.readable || f.writable);

      res.json({
        agent: agent.id,
        readPatterns: agent.permissions?.read ?? [],
        writePatterns: agent.permissions?.write ?? [],
        files,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/{id}/introduction:
   *   get:
   *     tags: [Agents]
   *     summary: Generate an agent introduction
   *     description: Ask the agent to introduce themselves via LLM. Not persisted.
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - name: developerName
   *         in: query
   *         schema:
   *           type: string
   *         description: Optional developer name to personalise the greeting
   *     responses:
   *       200:
   *         description: Introduction generated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 content:
   *                   type: string
   *                 agentId:
   *                   type: string
   *                 agentName:
   *                   type: string
   *                 timestamp:
   *                   type: string
   *       404:
   *         description: Agent not found
   *       503:
   *         description: LLM unavailable
   */
  router.get('/:id/introduction', async (req: any, res: any, next: any) => {
    try {
      const agents = agentManager.resolveAgent(req.params.id);
      if (!agents || agents.length === 0) {
        return res.status(404).json({ error: 'Agent not found', details: `No agent matching '${req.params.id}'` });
      }
      const agent = agents[0];
      const developerName = typeof req.query.developerName === 'string' ? req.query.developerName : undefined;
      const llm = new LlmService(agentManager.workspaceRoot);
      const content = await generateIntroduction(llm, agentManager, agent, undefined, developerName);
      res.json({
        content,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

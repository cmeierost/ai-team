import express, { Request, Response } from "express";
import { TaskManager, TaskFilter } from "@ai-team/service";
import { TaskStatus, TaskPriority, TaskType, type AgentManager } from "@ai-team/core";

export function createTaskRoutes(workspaceRoot: string, agentManager?: AgentManager): express.Router {
  const router = express.Router();
  const taskManager = new TaskManager(workspaceRoot, agentManager);

  // Initialize task manager
  taskManager.initialize().catch((err) => {
    console.error("Failed to initialize TaskManager:", err);
  });

  /**
   * @openapi
   * /api/tasks:
   *   get:
   *     tags: [Tasks]
   *     summary: List tasks with optional filters
   *     description: Returns all tasks matching the specified filters
   *     parameters:
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [todo, in-progress, blocked, done, cancelled]
   *         description: Filter by task status
   *       - in: query
   *         name: priority
   *         schema:
   *           type: string
   *           enum: [low, medium, high, urgent]
   *         description: Filter by priority
   *       - in: query
   *         name: assignedTo
   *         schema:
   *           type: string
   *         description: Filter by assigned agent ID
   *       - in: query
   *         name: createdBy
   *         schema:
   *           type: string
   *         description: Filter by creator ID
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [feature, bug, chore, docs, test, refactor]
   *         description: Filter by task type
   *       - in: query
   *         name: tags
   *         schema:
   *           type: array
   *           items:
   *             type: string
   *         description: Filter by tags
   *       - in: query
   *         name: parentTaskId
   *         schema:
   *           type: string
   *         description: Filter by parent task ID (use 'null' for root tasks)
   *     responses:
   *       200:
   *         description: Array of tasks
   *       500:
   *         description: Server error
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const filter: TaskFilter = {};

      if (req.query.status) {
        if (Array.isArray(req.query.status)) {
          filter.status = req.query.status as TaskStatus[];
        } else {
          filter.status = req.query.status as TaskStatus;
        }
      }

      if (req.query.priority) {
        if (Array.isArray(req.query.priority)) {
          filter.priority = req.query.priority as TaskPriority[];
        } else {
          filter.priority = req.query.priority as TaskPriority;
        }
      }

      if (req.query.assignedTo) {
        filter.assignedTo = req.query.assignedTo as string;
      }

      if (req.query.createdBy) {
        filter.createdBy = req.query.createdBy as string;
      }

      if (req.query.type) {
        if (Array.isArray(req.query.type)) {
          filter.type = req.query.type as TaskType[];
        } else {
          filter.type = req.query.type as TaskType;
        }
      }

      if (req.query.tags) {
        filter.tags = Array.isArray(req.query.tags)
          ? (req.query.tags as string[])
          : [req.query.tags as string];
      }

      if (req.query.parentTaskId !== undefined) {
        filter.parentTaskId = req.query.parentTaskId === "null" ? undefined : (req.query.parentTaskId as string);
      }

      const tasks = await taskManager.listTasks(filter);
      res.json(tasks);
    } catch (error) {
      console.error("Error listing tasks:", error);
      res.status(500).json({
        error: "Failed to list tasks",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/templates:
   *   get:
   *     tags: [Tasks]
   *     summary: List task templates
   *     description: Returns all available task templates
   *     responses:
   *       200:
   *         description: Array of task templates
   *       500:
   *         description: Server error
   */
  router.get("/templates", async (req: Request, res: Response) => {
    try {
      const templates = await taskManager.getTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error listing templates:", error);
      res.status(500).json({
        error: "Failed to list templates",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/dashboard:
   *   get:
   *     tags: [Tasks]
   *     summary: Get task statistics
   *     description: Returns aggregated statistics about all tasks
   *     responses:
   *       200:
   *         description: Task statistics object
   *       500:
   *         description: Server error
   */
  router.get("/dashboard", async (req: Request, res: Response) => {
    try {
      const statistics = await taskManager.getStatistics();
      res.json(statistics);
    } catch (error) {
      console.error("Error getting dashboard statistics:", error);
      res.status(500).json({
        error: "Failed to get dashboard statistics",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/{taskId}:
   *   get:
   *     tags: [Tasks]
   *     summary: Get a specific task
   *     description: Returns detailed information about a single task
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: string
   *         description: Task ID (UUID)
   *     responses:
   *       200:
   *         description: Task data
   *       404:
   *         description: Task not found
   *       500:
   *         description: Server error
   */
  router.get("/:taskId", async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = await taskManager.getTask(taskId);

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      res.json(task);
    } catch (error) {
      console.error("Error getting task:", error);
      res.status(500).json({
        error: "Failed to get task",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/{taskId}/hierarchy:
   *   get:
   *     tags: [Tasks]
   *     summary: Get task with all subtasks
   *     description: Returns a task and its complete subtask hierarchy
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: string
   *         description: Task ID (UUID)
   *     responses:
   *       200:
   *         description: Task hierarchy
   *       500:
   *         description: Server error
   */
  router.get("/:taskId/hierarchy", async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const hierarchy = await taskManager.getTaskHierarchy(taskId);
      res.json(hierarchy);
    } catch (error) {
      console.error("Error getting task hierarchy:", error);
      res.status(500).json({
        error: "Failed to get task hierarchy",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks:
   *   post:
   *     tags: [Tasks]
   *     summary: Create a new task
   *     description: Create a new task with the specified properties
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - type
   *               - title
   *               - createdBy
   *               - createdByType
   *             properties:
   *               type:
   *                 type: string
   *                 enum: [feature, bug, chore, docs, test, refactor]
   *                 description: Task type
   *               title:
   *                 type: string
   *                 description: Task title
   *               description:
   *                 type: string
   *                 description: Task description
   *               createdBy:
   *                 type: string
   *                 description: Creator ID
   *               createdByType:
   *                 type: string
   *                 enum: [agent, developer]
   *                 description: Creator type
   *               assignedTo:
   *                 type: string
   *                 description: Assigned agent ID
   *               priority:
   *                 type: string
   *                 enum: [low, medium, high, urgent]
   *                 description: Task priority
   *               status:
   *                 type: string
   *                 enum: [todo, in-progress, blocked, done, cancelled]
   *                 description: Task status
   *               tags:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Task tags
   *               parentTaskId:
   *                 type: string
   *                 description: Parent task ID (for subtasks)
   *     responses:
   *       201:
   *         description: Created task
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: Server error
   */
  router.post("/", async (req: Request, res: Response) => {
    try {
      const taskData = req.body;

      // Validate required fields
      if (!taskData.type || !taskData.title || !taskData.createdBy || !taskData.createdByType) {
        res.status(400).json({
          error: "Missing required fields",
          required: ["type", "title", "createdBy", "createdByType"],
        });
        return;
      }

      const task = await taskManager.createTask(taskData);
      res.status(201).json(task);
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(500).json({
        error: "Failed to create task",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/from-template:
   *   post:
   *     tags: [Tasks]
   *     summary: Create task from template
   *     description: Create a new task from a predefined template
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - templateId
   *               - variables
   *             properties:
   *               templateId:
   *                 type: string
   *                 description: Template ID
   *               variables:
   *                 type: object
   *                 description: Template variable values
   *               overrides:
   *                 type: object
   *                 description: Property overrides
   *     responses:
   *       201:
   *         description: Created task
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: Server error
   */
  router.post("/from-template", async (req: Request, res: Response) => {
    try {
      const { templateId, variables, overrides } = req.body;

      if (!templateId || !variables) {
        res.status(400).json({
          error: "Missing required fields",
          required: ["templateId", "variables"],
        });
        return;
      }

      const task = await taskManager.createFromTemplate(templateId, variables, overrides);
      res.status(201).json(task);
    } catch (error) {
      console.error("Error creating task from template:", error);
      res.status(500).json({
        error: "Failed to create task from template",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/{taskId}:
   *   patch:
   *     tags: [Tasks]
   *     summary: Update a task
   *     description: Update task properties
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: string
   *         description: Task ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *               description:
   *                 type: string
   *               status:
   *                 type: string
   *                 enum: [todo, in-progress, blocked, done, cancelled]
   *               priority:
   *                 type: string
   *                 enum: [low, medium, high, urgent]
   *               assignedTo:
   *                 type: string
   *               tags:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Updated task
   *       500:
   *         description: Server error
   */
  router.patch("/:taskId", async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const updates = req.body;

      const task = await taskManager.updateTask(taskId, updates);
      res.json(task);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(500).json({
        error: "Failed to update task",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/{taskId}/split:
   *   post:
   *     tags: [Tasks]
   *     summary: Split task into subtasks
   *     description: Break a task down into multiple subtasks
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: string
   *         description: Task ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - subtasks
   *             properties:
   *               subtasks:
   *                 type: array
   *                 items:
   *                   type: object
   *                 description: Array of subtask definitions
   *     responses:
   *       201:
   *         description: Created subtasks
   *       400:
   *         description: Invalid subtasks array
   *       500:
   *         description: Server error
   */
  router.post("/:taskId/split", async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const { subtasks } = req.body;

      if (!Array.isArray(subtasks) || subtasks.length === 0) {
        res.status(400).json({
          error: "Invalid subtasks array",
          message: "subtasks must be a non-empty array",
        });
        return;
      }

      const createdSubtasks = await taskManager.splitTask(taskId, subtasks);
      res.status(201).json(createdSubtasks);
    } catch (error) {
      console.error("Error splitting task:", error);
      res.status(500).json({
        error: "Failed to split task",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/{taskId}/delegate:
   *   post:
   *     tags: [Tasks]
   *     summary: Delegate task to another agent
   *     description: Transfer task ownership to a different agent
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: string
   *         description: Task ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - fromAgentId
   *               - toAgentId
   *             properties:
   *               fromAgentId:
   *                 type: string
   *                 description: Current agent ID
   *               toAgentId:
   *                 type: string
   *                 description: Target agent ID
   *               reason:
   *                 type: string
   *                 description: Delegation reason
   *     responses:
   *       200:
   *         description: Updated task
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: Server error
   */
  router.post("/:taskId/delegate", async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const { fromAgentId, toAgentId, reason } = req.body;

      if (!fromAgentId || !toAgentId) {
        res.status(400).json({
          error: "Missing required fields",
          required: ["fromAgentId", "toAgentId"],
        });
        return;
      }

      const task = await taskManager.delegateTask(taskId, fromAgentId, toAgentId, reason);
      res.json(task);
    } catch (error) {
      console.error("Error delegating task:", error);
      res.status(500).json({
        error: "Failed to delegate task",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /api/tasks/{taskId}/time:
   *   post:
   *     tags: [Tasks]
   *     summary: Log time on a task
   *     description: Record time spent working on a task
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: string
   *         description: Task ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - agentId
   *               - durationMinutes
   *             properties:
   *               agentId:
   *                 type: string
   *                 description: Agent ID who worked on task
   *               durationMinutes:
   *                 type: integer
   *                 description: Time spent in minutes
   *               description:
   *                 type: string
   *                 description: Optional description of work done
   *     responses:
   *       200:
   *         description: Updated task
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: Server error
   */
  router.post("/:taskId/time", async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const { agentId, durationMinutes, description } = req.body;

      if (!agentId || !durationMinutes) {
        res.status(400).json({
          error: "Missing required fields",
          required: ["agentId", "durationMinutes"],
        });
        return;
      }

      const task = await taskManager.logTime(taskId, agentId, durationMinutes, description);
      res.json(task);
    } catch (error) {
      console.error("Error logging time:", error);
      res.status(500).json({
        error: "Failed to log time",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

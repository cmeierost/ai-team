import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  TaskTemplate,
  TaskStatistics,
  WorkflowStep,
  TimeLogEntry,
  TaskDelegationRecord,
  type IAgentManager,
} from '@ai-team/core';
import matter from 'gray-matter';

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  assignedTo?: string;
  createdBy?: string;
  type?: TaskType | TaskType[];
  tags?: string[];
  parentTaskId?: string;
  includeSubtasks?: boolean;
}

export class TaskManager {
  private workspaceRoot: string;
  private tasksDir: string;
  private indexPath: string;
  private templatesPath: string;
  private index: Map<string, Task> | undefined;
  private agentManager?: IAgentManager;

  constructor(workspaceRoot: string, agentManager?: IAgentManager) {
    this.workspaceRoot = workspaceRoot;
    this.tasksDir = path.join(workspaceRoot, '.ai-team', 'tasks');
    this.indexPath = path.join(this.tasksDir, 'index.json');
    this.templatesPath = path.join(this.tasksDir, 'templates.json');
    this.agentManager = agentManager;
  }

  async getIndex(): Promise<Map<string, Task>> {
    if (!this.index) {
      this.index = await this.loadIndex();
    }
    return this.index;
  }

  async refresh(): Promise<void> {
    this.index = undefined;
    await this.getIndex();
  }

  private async loadIndex(): Promise<Map<string, Task>> {
    await fs.mkdir(this.tasksDir, { recursive: true });

    let index: Map<string, Task>;
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf-8');
      const tasks = JSON.parse(indexData) as Task[];
      index = new Map(tasks.map((task) => [task.id, task]));
    } catch (error) {
      // Index doesn't exist yet, start fresh
      index = new Map();
    }

    // Create default templates if they don't exist
    try {
      await fs.access(this.templatesPath);
    } catch {
      await this.createDefaultTemplates();
    }

    return index;
  }

  private async createDefaultTemplates(): Promise<void> {
    const defaultTemplates: TaskTemplate[] = [
      {
        id: 'feature-implementation',
        name: 'Feature Implementation',
        type: TaskType.FEATURE,
        description: 'Template for implementing a new feature',
        titleTemplate: 'Implement {feature_name}',
        descriptionTemplate:
          'Implement the {feature_name} feature according to specifications.\n\n## Requirements\n{requirements}\n\n## Acceptance Criteria\n{acceptance_criteria}',
        priority: TaskPriority.MEDIUM,
        estimatedHours: 8,
        requiresApproval: true,
        workflowSteps: [
          {
            title: 'Design & Planning',
            autoAssign: false,
            order: 1,
          },
          {
            title: 'Implementation',
            autoAssign: true,
            order: 2,
            dependencies: ['Design & Planning'],
          },
          {
            title: 'Testing',
            autoAssign: true,
            order: 3,
            dependencies: ['Implementation'],
          },
          {
            title: 'Code Review',
            autoAssign: false,
            order: 4,
            dependencies: ['Testing'],
          },
        ],
        tags: ['feature', 'development'],
      },
      {
        id: 'bug-fix',
        name: 'Bug Fix',
        type: TaskType.BUG,
        description: 'Template for fixing a bug',
        titleTemplate: 'Fix: {bug_summary}',
        descriptionTemplate:
          '## Bug Description\n{bug_description}\n\n## Steps to Reproduce\n{steps}\n\n## Expected Behavior\n{expected}\n\n## Actual Behavior\n{actual}',
        priority: TaskPriority.HIGH,
        estimatedHours: 4,
        requiresApproval: false,
        workflowSteps: [
          {
            title: 'Investigate & Reproduce',
            autoAssign: true,
            order: 1,
          },
          {
            title: 'Fix Implementation',
            autoAssign: true,
            order: 2,
            dependencies: ['Investigate & Reproduce'],
          },
          {
            title: 'Verification',
            autoAssign: false,
            order: 3,
            dependencies: ['Fix Implementation'],
          },
        ],
        tags: ['bug', 'fix'],
      },
      {
        id: 'documentation',
        name: 'Documentation',
        type: TaskType.DOCUMENTATION,
        description: 'Template for documentation tasks',
        titleTemplate: 'Document {topic}',
        descriptionTemplate:
          'Create documentation for {topic}.\n\n## Scope\n{scope}\n\n## Target Audience\n{audience}',
        priority: TaskPriority.LOW,
        estimatedHours: 2,
        requiresApproval: false,
        tags: ['documentation'],
      },
    ];

    await fs.writeFile(this.templatesPath, JSON.stringify(defaultTemplates, null, 2), 'utf-8');
  }

  private generateTaskId(type: TaskType): string {
    const prefix = type === TaskType.FEATURE ? 'FEAT' : type === TaskType.BUG ? 'BUG' : 'DOC';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  async createTask(
    taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'>
  ): Promise<Task> {
    const task: Task = {
      ...taskData,
      id: this.generateTaskId(taskData.type),
      status: TaskStatus.NOT_STARTED,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Initialize workflow steps if provided
    if (task.workflowSteps && task.workflowSteps.length > 0) {
      task.workflowSteps = task.workflowSteps.map((step, index) => ({
        ...step,
        id: step.id || `${task.id}-step-${index + 1}`,
        status: step.status || TaskStatus.NOT_STARTED,
      }));
    }

    // Save task to markdown file
    await this.saveTask(task);

    // Update index
    const index = await this.getIndex();
    index.set(task.id, task);
    await this.saveIndex();

    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    // Try index first
    const index = await this.getIndex();
    const cached = index.get(taskId);
    if (cached) {
      return cached;
    }

    // Try loading from file
    const taskPath = path.join(this.tasksDir, `${taskId}.md`);
    try {
      const content = await fs.readFile(taskPath, 'utf-8');
      const task = this.markdownToTask(content);
      index.set(task.id, task);
      return task;
    } catch {
      return null;
    }
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    let tasks = Array.from((await this.getIndex()).values());

    if (!filter) {
      return tasks;
    }

    // Resolve agent queries in filter if AgentManager is available
    let resolvedAssignedTo = filter.assignedTo;
    let resolvedCreatedBy = filter.createdBy;

    if (this.agentManager) {
      if (filter.assignedTo) {
        const resolved = await this.agentManager.resolveAgentForOperationAsync(
          filter.assignedTo,
          'filter tasks by assignedTo'
        );
        resolvedAssignedTo = resolved.id;
      }
      if (filter.createdBy) {
        const resolved = await this.agentManager.resolveAgentForOperationAsync(
          filter.createdBy,
          'filter tasks by createdBy'
        );
        resolvedCreatedBy = resolved.id;
      }
    }

    // Apply filters
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((task) => statuses.includes(task.status));
    }

    if (filter.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      tasks = tasks.filter((task) => priorities.includes(task.priority));
    }

    if (resolvedAssignedTo) {
      tasks = tasks.filter((task) => task.assignedTo === resolvedAssignedTo);
    }

    if (resolvedCreatedBy) {
      tasks = tasks.filter((task) => task.createdBy === resolvedCreatedBy);
    }

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      tasks = tasks.filter((task) => types.includes(task.type));
    }

    if (filter.tags && filter.tags.length > 0) {
      tasks = tasks.filter(
        (task) => task.tags && filter.tags!.some((tag) => task.tags!.includes(tag))
      );
    }

    if (filter.parentTaskId !== undefined) {
      tasks = tasks.filter((task) => task.parentTaskId === filter.parentTaskId);
    }

    return tasks;
  }

  async updateTask(taskId: string, updates: Partial<Task>): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const updatedTask: Task = {
      ...task,
      ...updates,
      id: task.id, // Preserve ID
      createdAt: task.createdAt, // Preserve creation date
      updatedAt: new Date(),
    };

    await this.saveTask(updatedTask);
    (await this.getIndex()).set(taskId, updatedTask);
    await this.saveIndex();

    return updatedTask;
  }

  async splitTask(
    taskId: string,
    subtasks: Array<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'parentTaskId'>>
  ): Promise<Task[]> {
    const parentTask = await this.getTask(taskId);
    if (!parentTask) {
      throw new Error(`Parent task ${taskId} not found`);
    }

    const createdSubtasks: Task[] = [];
    const subtaskIds: string[] = [];

    for (const subtaskData of subtasks) {
      const subtask = await this.createTask({
        ...subtaskData,
        parentTaskId: taskId,
      });
      createdSubtasks.push(subtask);
      subtaskIds.push(subtask.id);
    }

    // Update parent task
    await this.updateTask(taskId, {
      subtaskIds: [...(parentTask.subtaskIds || []), ...subtaskIds],
    });

    return createdSubtasks;
  }

  async delegateTask(
    taskId: string,
    fromAgentQuery: string,
    toAgentQuery: string,
    reason?: string
  ): Promise<Task> {
    // Resolve agent queries if AgentManager is available
    let fromAgentId = fromAgentQuery;
    let toAgentId = toAgentQuery;

    if (this.agentManager) {
      const resolvedFrom = await this.agentManager.resolveAgentForOperationAsync(
        fromAgentQuery,
        'delegate task from agent'
      );
      const resolvedTo = await this.agentManager.resolveAgentForOperationAsync(
        toAgentQuery,
        'delegate task to agent'
      );
      fromAgentId = resolvedFrom.id;
      toAgentId = resolvedTo.id;
    }

    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const delegationRecord: TaskDelegationRecord = {
      id: `${taskId}-delegation-${Date.now()}`,
      fromAgentId,
      toAgentId,
      delegatedAt: new Date(),
      reason,
      accepted: false,
    };

    const updatedTask = await this.updateTask(taskId, {
      status: TaskStatus.DELEGATED,
      delegatedTo: toAgentId,
      delegationHistory: [...(task.delegationHistory || []), delegationRecord],
    });

    return updatedTask;
  }

  async logTime(
    taskId: string,
    agentQuery: string,
    durationMinutes: number,
    description?: string
  ): Promise<Task> {
    // Resolve agent query if AgentManager is available
    let agentId = agentQuery;
    if (this.agentManager) {
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        agentQuery,
        'log time for task'
      );
      agentId = resolved.id;
    }

    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const timeEntry: TimeLogEntry = {
      id: `${taskId}-time-${Date.now()}`,
      taskId,
      agentId,
      startTime: new Date(Date.now() - durationMinutes * 60 * 1000),
      endTime: new Date(),
      durationMinutes,
      description,
      createdAt: new Date(),
    };

    const totalMinutes = (task.timeLog || []).reduce(
      (sum, entry) => sum + (entry.durationMinutes || 0),
      0
    );
    const actualHours = (totalMinutes + durationMinutes) / 60;

    const updatedTask = await this.updateTask(taskId, {
      timeLog: [...(task.timeLog || []), timeEntry],
      actualHours,
    });

    return updatedTask;
  }

  async getTaskHierarchy(taskId: string): Promise<Task[]> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const hierarchy: Task[] = [task];

    // Get all subtasks recursively
    if (task.subtaskIds && task.subtaskIds.length > 0) {
      for (const subtaskId of task.subtaskIds) {
        const subtaskHierarchy = await this.getTaskHierarchy(subtaskId);
        hierarchy.push(...subtaskHierarchy);
      }
    }

    return hierarchy;
  }

  async getStatistics(): Promise<TaskStatistics> {
    const allTasks = Array.from((await this.getIndex()).values());

    const tasksByStatus = Object.values(TaskStatus).reduce(
      (acc, status) => {
        acc[status] = allTasks.filter((task) => task.status === status).length;
        return acc;
      },
      {} as Record<TaskStatus, number>
    );

    const tasksByPriority = Object.values(TaskPriority).reduce(
      (acc, priority) => {
        acc[priority] = allTasks.filter((task) => task.priority === priority).length;
        return acc;
      },
      {} as Record<TaskPriority, number>
    );

    const tasksByAgent: Record<string, number> = {};
    allTasks.forEach((task) => {
      if (task.assignedTo) {
        tasksByAgent[task.assignedTo] = (tasksByAgent[task.assignedTo] || 0) + 1;
      }
    });

    const completedTasks = allTasks.filter((task) => task.status === TaskStatus.COMPLETED);
    const totalCompletionTime = completedTasks.reduce((sum, task) => {
      if (task.completedAt && task.startedAt) {
        return sum + (task.completedAt.getTime() - task.startedAt.getTime());
      }
      return sum;
    }, 0);
    const averageCompletionTime =
      completedTasks.length > 0 ? totalCompletionTime / completedTasks.length : undefined;

    const totalEstimatedHours = allTasks.reduce((sum, task) => sum + (task.estimatedHours || 0), 0);
    const totalActualHours = allTasks.reduce((sum, task) => sum + (task.actualHours || 0), 0);

    return {
      totalTasks: allTasks.length,
      tasksByStatus,
      tasksByPriority,
      tasksByAgent,
      averageCompletionTime,
      totalEstimatedHours,
      totalActualHours,
    };
  }

  async getTemplates(): Promise<TaskTemplate[]> {
    try {
      const content = await fs.readFile(this.templatesPath, 'utf-8');
      return JSON.parse(content) as TaskTemplate[];
    } catch {
      await this.createDefaultTemplates();
      return this.getTemplates();
    }
  }

  async createFromTemplate(
    templateId: string,
    variables: Record<string, string>,
    overrides?: Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'>>
  ): Promise<Task> {
    const templates = await this.getTemplates();
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    // Replace variables in title and description
    let title = template.titleTemplate;
    let description = template.descriptionTemplate;
    for (const [key, value] of Object.entries(variables)) {
      title = title.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      description = description.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    // Create workflow steps from template
    const workflowSteps: WorkflowStep[] | undefined = template.workflowSteps?.map((step, idx) => ({
      ...step,
      id: `step-${idx + 1}`,
      status: TaskStatus.NOT_STARTED,
    }));

    const taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status'> = {
      type: template.type,
      title,
      description,
      priority: template.priority,
      estimatedHours: template.estimatedHours,
      requiresApproval: template.requiresApproval,
      tags: template.tags,
      workflowSteps,
      createdBy: 'system',
      createdByType: 'human',
      ...overrides,
    };

    return this.createTask(taskData);
  }

  private taskToMarkdown(task: Task): string {
    const frontmatter = {
      id: task.id,
      type: task.type,
      title: task.title,
      createdBy: task.createdBy,
      createdByType: task.createdByType,
      assignedTo: task.assignedTo,
      status: task.status,
      priority: task.priority,
      requiresApproval: task.requiresApproval,
      approved: task.approved,
      approvedBy: task.approvedBy,
      approvedAt: task.approvedAt,
      parentTaskId: task.parentTaskId,
      subtaskIds: task.subtaskIds,
      executionMode: task.executionMode,
      workflowSteps: task.workflowSteps,
      estimatedHours: task.estimatedHours,
      actualHours: task.actualHours,
      timeLog: task.timeLog,
      dueDate: task.dueDate,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      cancelledAt: task.cancelledAt,
      tags: task.tags,
      sessionId: task.sessionId,
      artifactIds: task.artifactIds,
      delegationHistory: task.delegationHistory,
      delegatedTo: task.delegatedTo,
      blockedReason: task.blockedReason,
      blockedBy: task.blockedBy,
      metadata: task.metadata,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };

    const content = task.description || '';
    return matter.stringify(content, frontmatter);
  }

  private markdownToTask(content: string): Task {
    const parsed = matter(content);
    const frontmatter = parsed.data as any;

    return {
      id: frontmatter.id,
      type: frontmatter.type,
      title: frontmatter.title,
      description: parsed.content.trim() || undefined,
      createdBy: frontmatter.createdBy,
      createdByType: frontmatter.createdByType,
      assignedTo: frontmatter.assignedTo,
      status: frontmatter.status,
      priority: frontmatter.priority,
      requiresApproval: frontmatter.requiresApproval,
      approved: frontmatter.approved,
      approvedBy: frontmatter.approvedBy,
      approvedAt: frontmatter.approvedAt,
      parentTaskId: frontmatter.parentTaskId,
      subtaskIds: frontmatter.subtaskIds,
      executionMode: frontmatter.executionMode,
      workflowSteps: frontmatter.workflowSteps,
      estimatedHours: frontmatter.estimatedHours,
      actualHours: frontmatter.actualHours,
      timeLog: frontmatter.timeLog,
      dueDate: frontmatter.dueDate,
      startedAt: frontmatter.startedAt,
      completedAt: frontmatter.completedAt,
      cancelledAt: frontmatter.cancelledAt,
      tags: frontmatter.tags,
      sessionId: frontmatter.sessionId,
      artifactIds: frontmatter.artifactIds,
      delegationHistory: frontmatter.delegationHistory,
      delegatedTo: frontmatter.delegatedTo,
      blockedReason: frontmatter.blockedReason,
      blockedBy: frontmatter.blockedBy,
      metadata: frontmatter.metadata,
      createdAt: new Date(frontmatter.createdAt),
      updatedAt: new Date(frontmatter.updatedAt),
    };
  }

  private async saveTask(task: Task): Promise<void> {
    const taskPath = path.join(this.tasksDir, `${task.id}.md`);
    const content = this.taskToMarkdown(task);
    await fs.writeFile(taskPath, content, 'utf-8');
  }

  private async saveIndex(): Promise<void> {
    const tasks = Array.from(this.index!.values());
    await fs.writeFile(this.indexPath, JSON.stringify(tasks, null, 2), 'utf-8');
  }
}

# Task Management System

Comprehensive task management system for AI Team with support for workflows, delegation, time tracking, and human-agent collaboration.

## Overview

The task management system enables both humans and agents to create, assign, track, and complete tasks. It supports complex workflows with multiple steps, task delegation between agents, subtask hierarchies, and detailed time tracking.

### Key Features

- **Dual Creation**: Both humans and agents can create and assign tasks
- **Workflow Support**: Multi-step workflows with dependencies and auto-assignment
- **Task Delegation**: Delegate tasks with permission validation
- **Hierarchy**: Unlimited task/subtask nesting with execution modes
- **Time Tracking**: Estimated vs actual hours with detailed logs
- **Templates**: Reusable task templates with variable substitution
- **Approval System**: Human approval required for agent-created tasks
- **Priority & Status**: 4 priority levels and 7 status states
- **Session Integration**: Link tasks to chat sessions and artifacts

## Architecture

### Storage Model

Tasks are stored as Markdown files with YAML frontmatter, following the same pattern as agents:

```
.ai-team/tasks/
├── FEAT-202602-A3D5.md      # Individual task files
├── BUG-202602-B7E2.md
├── DOC-202602-C9F1.md
├── index.json                # Fast lookup index
└── templates.json            # Task templates
```

**Task ID Format**: `{TYPE}-{TIMESTAMP}-{RANDOM}`
- `FEAT-*` for features
- `BUG-*` for bugs
- `DOC-*` for documentation

### Components

1. **Core Types** (`packages/core/src/types/index.ts`)
   - Enums: TaskStatus, TaskPriority, TaskType, TaskExecutionMode
   - Interfaces: Task, WorkflowStep, TimeLogEntry, TaskDelegationRecord
   - Templates: TaskTemplate, TaskStatistics

2. **TaskManager Service** (`packages/service/src/task-manager.ts`)
   - CRUD operations
   - Workflow management
   - Time tracking
   - Template system

3. **API Routes** (`packages/api-server/src/routes/tasks.ts`)
   - 10 REST endpoints
   - Filter support
   - Statistics endpoint

4. **UI Components** (`packages/web/src/components/ContextPanel.tsx`)
   - Task list in context panel
   - Status icons and priority badges
   - Subtask indicators

## Data Model

### Task Interface

```typescript
interface Task {
  // Identity
  id: string;                    // FEAT-202602-A3D5
  type: TaskType;                // feature | bug | documentation
  title: string;
  description?: string;
  
  // Ownership
  createdBy: string;             // Agent or developer ID
  createdByType: "human" | "agent";
  assignedTo?: string;           // Current assignee
  
  // Status & Priority
  status: TaskStatus;            // 7 states (see below)
  priority: TaskPriority;        // low | medium | high | urgent
  
  // Approval System
  requiresApproval: boolean;     // Human approval needed?
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: Date;
  
  // Hierarchy
  parentTaskId?: string;         // Parent task
  subtaskIds?: string[];         // Child tasks
  executionMode?: TaskExecutionMode;  // sequential | parallel
  
  // Workflow
  workflowSteps?: WorkflowStep[];
  
  // Time Tracking
  estimatedHours?: number;
  actualHours?: number;
  timeLog?: TimeLogEntry[];
  dueDate?: Date;
  startedAt?: Date;
  completedAt?: Date;
  
  // Delegation
  delegationHistory?: TaskDelegationRecord[];
  delegatedTo?: string;
  
  // Blocking
  blockedReason?: string;
  blockedBy?: string[];          // Task IDs blocking this one
  
  // Context
  tags?: string[];
  sessionId?: string;            // Linked chat session
  artifactIds?: string[];        // Linked briefs/documents
  metadata?: Record<string, any>;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date;
}
```

### Task Status States

1. **NOT_STARTED** ⭕ - Created but not begun
2. **IN_PROGRESS** 🔵 - Currently being worked on
3. **BLOCKED** 🔴 - Waiting on dependencies or external factors
4. **WAITING_APPROVAL** ⏸️ - Pending human approval
5. **COMPLETED** ✅ - Successfully finished
6. **CANCELLED** ❌ - Abandoned or no longer needed
7. **DELEGATED** ↗️ - Handed off to another agent

### Workflow Steps

```typescript
interface WorkflowStep {
  id: string;
  title: string;
  description?: string;
  assignedTo?: string;
  autoAssign: boolean;          // Auto-assign when dependencies complete
  accepted?: boolean;            // Agent accepted auto-assignment?
  status: TaskStatus;
  dependencies?: string[];       // Step IDs that must complete first
  order: number;
  completedAt?: Date;
}
```

### Time Tracking

```typescript
interface TimeLogEntry {
  id: string;
  taskId: string;
  agentId: string;
  startTime: Date;
  endTime?: Date;
  durationMinutes?: number;
  description?: string;
  createdAt: Date;
}
```

### Task Delegation

```typescript
interface TaskDelegationRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  delegatedAt: Date;
  reason?: string;
  accepted: boolean;
  acceptedAt?: Date;
}
```

## API Endpoints

Base URL: `/api/tasks`

### List Tasks
```http
GET /api/tasks
Query Parameters:
  - status: TaskStatus | TaskStatus[]
  - priority: TaskPriority | TaskPriority[]
  - assignedTo: string
  - createdBy: string
  - type: TaskType | TaskType[]
  - tags: string[]
  - parentTaskId: string | "null" (for top-level tasks)

Response: Task[]
```

### Get Task
```http
GET /api/tasks/:taskId
Response: Task
```

### Get Task Hierarchy
```http
GET /api/tasks/:taskId/hierarchy
Response: Task[] (task + all subtasks recursively)
```

### Create Task
```http
POST /api/tasks
Body: {
  type: TaskType;
  title: string;
  description?: string;
  createdBy: string;
  createdByType: "human" | "agent";
  assignedTo?: string;
  priority: TaskPriority;
  requiresApproval: boolean;
  estimatedHours?: number;
  dueDate?: Date;
  tags?: string[];
  workflowSteps?: Omit<WorkflowStep, "id" | "status">[];
}
Response: Task
```

### Update Task
```http
PATCH /api/tasks/:taskId
Body: Partial<Task>
Response: Task
```

### Split Task
```http
POST /api/tasks/:taskId/split
Body: {
  subtasks: Array<Omit<Task, "id" | "parentTaskId" | "status" | "createdAt" | "updatedAt">>
}
Response: Task[] (created subtasks)
```

### Delegate Task
```http
POST /api/tasks/:taskId/delegate
Body: {
  fromAgentId: string;
  toAgentId: string;
  reason?: string;
}
Response: Task
```

### Log Time
```http
POST /api/tasks/:taskId/time
Body: {
  agentId: string;
  durationMinutes: number;
  description?: string;
}
Response: Task
```

### Get Dashboard Statistics
```http
GET /api/tasks/dashboard
Response: TaskStatistics
```

### List Templates
```http
GET /api/tasks/templates
Response: TaskTemplate[]
```

### Create from Template
```http
POST /api/tasks/from-template
Body: {
  templateId: string;
  variables: Record<string, string>;
  overrides?: Partial<Task>;
}
Response: Task
```

## Task Templates

The system includes 3 built-in templates:

### 1. Feature Implementation
```yaml
id: feature-implementation
type: FEATURE
priority: MEDIUM
estimatedHours: 8
requiresApproval: true
titleTemplate: "Implement {feature_name}"
descriptionTemplate: |
  Implement the {feature_name} feature according to specifications.
  
  ## Requirements
  {requirements}
  
  ## Acceptance Criteria
  {acceptance_criteria}

workflowSteps:
  - Design & Planning (manual assignment)
  - Implementation (auto-assign after design)
  - Testing (auto-assign after implementation)
  - Code Review (manual assignment)
```

### 2. Bug Fix
```yaml
id: bug-fix
type: BUG
priority: HIGH
estimatedHours: 4
requiresApproval: false
titleTemplate: "Fix: {bug_summary}"
descriptionTemplate: |
  ## Bug Description
  {bug_description}
  
  ## Steps to Reproduce
  {steps}
  
  ## Expected Behavior
  {expected}
  
  ## Actual Behavior
  {actual}

workflowSteps:
  - Investigate & Reproduce (auto-assign)
  - Fix Implementation (auto-assign)
  - Verification (manual assignment)
```

### 3. Documentation
```yaml
id: documentation
type: DOCUMENTATION
priority: LOW
estimatedHours: 2
requiresApproval: false
titleTemplate: "Document {topic}"
descriptionTemplate: |
  Create documentation for {topic}.
  
  ## Scope
  {scope}
  
  ## Target Audience
  {audience}
```

## Usage Examples

### Create a Simple Task

```typescript
const taskManager = new TaskManager(workspaceRoot);
await taskManager.initialize();

const task = await taskManager.createTask({
  type: TaskType.FEATURE,
  title: "Add user authentication",
  description: "Implement JWT-based authentication",
  createdBy: "clemens-meier",
  createdByType: "human",
  assignedTo: "john-smith",
  priority: TaskPriority.HIGH,
  requiresApproval: false,
  estimatedHours: 16,
  dueDate: new Date("2026-03-15"),
  tags: ["auth", "security"]
});
```

### Create Task with Workflow

```typescript
const task = await taskManager.createTask({
  type: TaskType.FEATURE,
  title: "Implement payment integration",
  createdBy: "product-manager",
  createdByType: "human",
  priority: TaskPriority.URGENT,
  requiresApproval: true,
  workflowSteps: [
    {
      title: "Design API integration",
      autoAssign: false,
      order: 1
    },
    {
      title: "Implement payment flow",
      assignedTo: "backend-dev",
      autoAssign: true,
      order: 2,
      dependencies: ["Design API integration"]
    },
    {
      title: "Add error handling",
      autoAssign: true,
      order: 3,
      dependencies: ["Implement payment flow"]
    }
  ]
});
```

### Create from Template

```typescript
const task = await taskManager.createFromTemplate(
  "bug-fix",
  {
    bug_summary: "Login form validation",
    bug_description: "Email validation accepts invalid addresses",
    steps: "1. Go to /login\n2. Enter 'invalid.email'\n3. Click Submit",
    expected: "Should show validation error",
    actual: "Form submits and causes 500 error"
  },
  {
    assignedTo: "frontend-dev",
    priority: TaskPriority.URGENT
  }
);
```

### Split Task into Subtasks

```typescript
await taskManager.splitTask("FEAT-202602-A3D5", [
  {
    type: TaskType.FEATURE,
    title: "Create database schema",
    createdBy: "john-smith",
    createdByType: "agent",
    assignedTo: "john-smith",
    priority: TaskPriority.HIGH,
    requiresApproval: false
  },
  {
    type: TaskType.FEATURE,
    title: "Implement API endpoints",
    createdBy: "john-smith",
    createdByType: "agent",
    assignedTo: "john-smith",
    priority: TaskPriority.HIGH,
    requiresApproval: false
  }
]);
```

### Delegate Task

```typescript
await taskManager.delegateTask(
  "FEAT-202602-A3D5",
  "john-smith",
  "jane-doe",
  "Jane has more experience with payment systems"
);
```

### Log Time

```typescript
await taskManager.logTime(
  "FEAT-202602-A3D5",
  "john-smith",
  120, // 2 hours
  "Implemented basic payment flow"
);
```

### Query Tasks

```typescript
// Get all high-priority tasks assigned to an agent
const tasks = await taskManager.listTasks({
  assignedTo: "john-smith",
  priority: TaskPriority.HIGH,
  status: [TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS]
});

// Get all blocked tasks
const blockedTasks = await taskManager.listTasks({
  status: TaskStatus.BLOCKED
});

// Get top-level tasks (no parent)
const topLevelTasks = await taskManager.listTasks({
  parentTaskId: undefined
});
```

### Get Statistics

```typescript
const stats = await taskManager.getStatistics();
console.log(`Total tasks: ${stats.totalTasks}`);
console.log(`Completed: ${stats.tasksByStatus[TaskStatus.COMPLETED]}`);
console.log(`Average completion time: ${stats.averageCompletionTime}ms`);
console.log(`John's tasks: ${stats.tasksByAgent["john-smith"]}`);
```

## Storage Format

Tasks are stored as Markdown files with YAML frontmatter:

```markdown
---
id: FEAT-202602-A3D5
type: feature
title: Add user authentication
createdBy: clemens-meier
createdByType: human
assignedTo: john-smith
status: in_progress
priority: high
requiresApproval: false
estimatedHours: 16
actualHours: 5.5
tags:
  - auth
  - security
workflowSteps:
  - id: step-1
    title: Design auth flow
    status: completed
    autoAssign: false
    order: 1
    completedAt: 2026-02-27T10:15:00Z
  - id: step-2
    title: Implement JWT
    status: in_progress
    autoAssign: true
    order: 2
timeLog:
  - id: FEAT-202602-A3D5-time-1
    agentId: john-smith
    durationMinutes: 120
    description: Initial JWT implementation
    createdAt: 2026-02-27T14:30:00Z
createdAt: 2026-02-27T09:00:00Z
updatedAt: 2026-02-27T14:35:00Z
---

Implement JWT-based authentication for the application.

## Requirements
- Support email/password login
- Generate JWT tokens with 24h expiry
- Implement refresh token flow
- Add password reset functionality

## Acceptance Criteria
- [ ] Users can register with email/password
- [ ] Users can login and receive JWT token
- [ ] Protected routes verify JWT
- [ ] Tokens auto-refresh before expiry
```

## Integration Points

### With Chat System

Tasks can be linked to chat sessions:

```typescript
const task = await taskManager.createTask({
  // ... other fields
  sessionId: "session-2026-02-27-abc123",
  artifactIds: ["brief-auth-design"]
});
```

When an agent completes a task, the completion can be announced in the linked chat session.

### With Delegation System

Task delegation validates against the agent's `delegatesTo` rules:

```typescript
// Agent definition
{
  id: "john-smith",
  delegatesTo: ["jane-doe", "senior-dev"]
}

// Valid delegation
await taskManager.delegateTask("FEAT-1", "john-smith", "jane-doe");

// Invalid delegation would require permission check
// (currently not enforced, planned for future)
```

### With Context Panel

Tasks assigned to an agent appear in the context panel:
- 🔵 Status icon (⭕ not started, 🔵 in progress, etc.)
- Priority badge (color-coded)
- Due date
- Subtask count

## Workflow Execution

### Auto-Assignment Flow

1. Task created with workflow steps
2. Manual steps require explicit assignment
3. When dependencies complete, auto-assign steps trigger
4. Agent receives notification (planned)
5. Agent must accept via "Allow" button (planned)
6. `accepted: true` field set on workflow step
7. Agent begins work

### Sequential vs Parallel Execution

```typescript
// Sequential: Each subtask waits for previous to complete
const task = await taskManager.createTask({
  // ...
  executionMode: TaskExecutionMode.SEQUENTIAL,
  subtaskIds: ["SUB-1", "SUB-2", "SUB-3"]
});

// Parallel: All subtasks can run simultaneously
const task = await taskManager.createTask({
  // ...
  executionMode: TaskExecutionMode.PARALLEL,
  subtaskIds: ["SUB-1", "SUB-2", "SUB-3"]
});
```

## UI Components

### Context Panel Tasks Section

Shows tasks assigned to the current agent:
- Header: "✅ Tasks" with count badge
- Each task displays:
  - Status icon
  - Title
  - Priority badge (color-coded)
  - Due date (if set)
  - Subtask count (if any)
- Click to view details (planned)

### Priority Colors

- **Urgent**: Red (#f44336)
- **High**: Orange (#ff9800)
- **Medium**: Blue (#2196f3)
- **Low**: Green (#4caf50)

### Status Icons

- ⭕ Not Started
- 🔵 In Progress
- 🔴 Blocked
- ⏸️ Waiting Approval
- ✅ Completed
- ❌ Cancelled
- ↗️ Delegated

## Future Enhancements

### Planned Features

1. **Task Dashboard** (`/tasks` route)
   - Global view of all tasks across agents
   - Kanban board view
   - Gantt chart timeline
   - Filter and sort controls
   - Statistics widgets

2. **Agent Tools**
   - `create_task` tool for agents
   - `update_task_status` tool
   - `delegate_task` tool
   - `log_work_time` tool

3. **Notifications**
   - Avatar badge showing open task count
   - Browser notifications for task assignments
   - Email notifications (optional)

4. **Advanced Workflow**
   - Visual workflow editor
   - Conditional branching
   - Automatic status transitions
   - SLA tracking

5. **Time Tracking UI**
   - Start/stop timer in chat panel
   - Weekly timesheet view
   - Burndown charts

6. **Collaboration**
   - Task comments/discussion
   - @mentions
   - File attachments
   - Activity feed

## Best Practices

### Task Creation

- Use descriptive titles (verb + object: "Implement authentication")
- Include acceptance criteria in description
- Set realistic estimates (pad by 25% for unknowns)
- Tag appropriately for filtering
- Link to related sessions and artifacts

### Task Assignment

- Assign to agents with relevant specializations
- Check agent's current workload before assigning
- Use delegation for specialized work
- Require approval for high-impact changes

### Workflow Design

- Keep steps focused and atomic
- Use dependencies to enforce order
- Auto-assign routine steps
- Reserve manual assignment for decision points

### Time Tracking

- Log time daily while memory is fresh
- Include brief description of work done
- Track both successful and experimental work
- Review estimates vs actuals for learning

### Task Lifecycle

1. **Creation**: Define clearly with acceptance criteria
2. **Assignment**: Match to agent capabilities
3. **Execution**: Track progress, log time
4. **Review**: Validate completion against criteria
5. **Completion**: Document learnings
6. **Retrospective**: Update estimates for similar future tasks

## Troubleshooting

### Task Not Showing in UI

- Check that task is assigned to the agent
- Verify API endpoint returns the task
- Check browser console for errors
- Refresh the context panel

### Workflow Step Not Auto-Assigning

- Verify all dependencies are completed
- Check `autoAssign: true` is set
- Ensure `assignedTo` is set in step definition
- Check for errors in TaskManager logs

### Delegation Failed

- Verify agent has permission to delegate
- Check that target agent exists
- Ensure `delegatesTo` includes target (planned validation)
- Check for network errors

### Time Tracking Incorrect

- Verify duration is in minutes
- Check that actualHours is being calculated
- Ensure time log entries are being saved
- Refresh task data from API

## Related Documentation

- [API Contracts](../api/contracts.md)
- [Architecture Overview](../architecture/overview.md)
- [Session Management](./session-management.md) (planned)
- [Chat Integration](./chat-integration.md) (planned)

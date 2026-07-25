# Workflow Composition Guide

Workflows in the AI Team system are first-class composable units. Any workflow can be used as a command/tool in another workflow, enabling powerful orchestration patterns.

## Core Concepts

### 1. Workflows are Commands

Every `WorkflowDefinition` can be converted to an `ICommand` using `WorkflowRunnerFactory.asCommand()`. This makes workflows interoperable with the rest of the command system.

```typescript
const factory = container.resolve<IWorkflowRunnerFactory>(TOKENS.WorkflowRunnerFactory);

const myWorkflow: WorkflowDefinition<MyState> = {
  id: 'my-workflow',
  version: '1',
  description: 'Does something useful',
  availableIn: { tool: true },
  prepare: (params) => params as MyState,
  toResult: (state) => ({ result: state.output }),
  steps: [
    /* ... */
  ],
};

// Convert to command
const myCommand = factory.asCommand(myWorkflow);

// Register in DI container
container.registerInstance('my-workflow', myCommand);
```

### 2. Composing Workflows

Once a workflow is registered as a command, any other workflow can call it using a command step:

```typescript
const parentWorkflow: WorkflowDefinition<ParentState> = {
  id: 'parent-workflow',
  steps: [
    {
      id: 'call-child',
      command: 'my-workflow', // Reference the registered workflow
      params: (state) => ({
        input: state.someData,
      }),
      applyResult: (state, result) => ({
        ...state,
        childOutput: result,
      }),
    },
  ],
};
```

### 3. Workflow Lifecycle

Each workflow has a clear transformation pipeline:

```
Input Params → prepare() → Initial State → Steps → Final State → toResult() → Output Data
```

- **`prepare(params)`**: Transform input parameters into initial workflow state
- **`steps`**: Execute workflow logic, transforming state at each step
- **`toResult(state)`**: Extract final output data from state

### 4. Workflow Return Commands

Interactive workflows may define the command that `/return` executes:

```typescript
const delegatedReview: WorkflowDefinition<ReviewState> = {
  id: 'delegated-review',
  description: 'Review delegated work',
  availableIn: { tool: true },
  return: {
    command: 'review-return-to-parent',
    args: {
      includeOpenQuestions: true,
    },
  },
  steps: [
    // ...
  ],
};
```

For CLI, slash-command, and direct callers, the command keeps the familiar
`execute()` compatibility path. When an XState parent resolves that same
registered command, the workflow runner detects its actor capability and
invokes the child machine directly. The parent receives the child's typed
`toResult()` output through `onDone`; it never blocks on the child's
promise-based `execute()` wrapper. Ordinary commands continue to run as
promise actors through the same command registry.

The runner resolves `return.args` against current workflow state and exposes
the contract as `ExecutionContext.workflowReturn`. `/return` dispatches the
configured command through the normal command pipeline. The return command is
responsible for producing the return payload and restoring its parent context.
When no custom return command is defined, `/return` uses the response from the
last completed command step. It reports an error only when neither source
exists.

Chat uses this same mechanism with `session-handoff-return`; that command
resolves the persisted parent handoff frame and invokes `com_handoff` in
`back` mode so summary generation and session restoration stay in the handoff
tool.

## Complete Example

### Step 1: Define a Reusable Workflow

```typescript
// approval-workflow.ts
interface ApprovalState {
  requestId: string;
  approved?: boolean;
  approver?: string;
}

export const approvalWorkflow: WorkflowDefinition<ApprovalState> = {
  id: 'approval-workflow',
  version: '1',
  description: 'Generic approval workflow',
  availableIn: { tool: true },

  prepare: (params: unknown) => params as ApprovalState,

  toResult: (state) => ({
    approved: state.approved ?? false,
    approver: state.approver,
  }),

  steps: [
    {
      id: 'ask-approval',
      command: 'com_ask',
      params: (state) => ({
        question: `Approve request ${state.requestId}?`,
        choices: [
          { label: 'Approve', value: 'yes' },
          { label: 'Reject', value: 'no' },
        ],
      }),
      applyResult: (state, result: any) => ({
        ...state,
        approved: result.answer === 'yes',
        approver: 'current-user',
      }),
    },
  ],
};
```

### Step 2: Register as Command

```typescript
// registration.ts
export function registerWorkflows(container: IServiceContainer) {
  const factory = container.resolve<IWorkflowRunnerFactory>(
    CORE_SERVICE_TOKENS.WorkflowRunnerFactory
  );

  // Convert workflow to command
  const approvalCommand = factory.asCommand(approvalWorkflow);

  // Register in container
  container.registerInstance('approval-workflow', approvalCommand);
}
```

### Step 3: Compose in Another Workflow

```typescript
// deploy-workflow.ts
interface DeployState {
  environment: string;
  manifestPath: string;
  approvalResult?: any;
  deployed?: boolean;
}

export const deployWorkflow: WorkflowDefinition<DeployState> = {
  id: 'deploy-workflow',
  version: '1',
  description: 'Deploy with approval gate',
  availableIn: { tool: true },

  prepare: (params: unknown) => params as DeployState,

  toResult: (state) => ({
    deployed: state.deployed ?? false,
    environment: state.environment,
  }),

  steps: [
    {
      id: 'request-approval',
      command: 'approval-workflow', // ← Compose the approval workflow!
      params: (state) => ({
        requestId: `deploy-${state.environment}`,
      }),
      applyResult: (state, result) => ({
        ...state,
        approvalResult: result,
      }),
    },
    {
      id: 'execute-deploy',
      skipWhen: 'approvalResult.approved !== true', // Guard on approval
      command: 'kubectl-apply',
      params: (state) => ({
        manifest: state.manifestPath,
        environment: state.environment,
      }),
      applyResult: (state, result) => ({
        ...state,
        deployed: true,
      }),
    },
  ],
};
```

## Patterns

### Pattern 1: Sequential Composition

Call workflows one after another:

```typescript
steps: [
  { id: 'step1', command: 'workflow-a', params: (s) => s.input1 },
  { id: 'step2', command: 'workflow-b', params: (s) => s.input2 },
];
```

### Pattern 2: Conditional Composition

Call workflows conditionally:

```typescript
steps: [
  {
    id: 'conditional-workflow',
    command: 'special-workflow',
    skipWhen: 'needsSpecialHandling !== true',
    params: (s) => s.specialInput,
  },
];
```

### Pattern 3: Loop Composition

Call a workflow multiple times in a loop:

```typescript
steps: [
  {
    kind: 'loop',
    id: 'process-items',
    while: 'itemIndex < items.length',
    steps: [
      {
        id: 'process-one',
        command: 'item-processor-workflow',
        params: (s) => s.items[s.itemIndex],
      },
    ],
  },
];
```

### Pattern 4: Parallel Fan-Out (Using State)

Process multiple items by storing intermediate results:

```typescript
interface FanOutState {
  items: string[];
  results: any[];
  currentIndex: number;
}

const fanOutWorkflow: WorkflowDefinition<FanOutState> = {
  steps: [
    {
      kind: 'loop',
      while: 'currentIndex < items.length',
      steps: [
        {
          id: 'process-item',
          command: 'item-workflow',
          params: (s) => ({ item: s.items[s.currentIndex] }),
          applyResult: (s, result) => ({
            ...s,
            results: [...s.results, result],
            currentIndex: s.currentIndex + 1,
          }),
        },
      ],
    },
  ],
};
```

## Best Practices

### 1. Design for Reusability

Make workflows single-purpose and parameterizable:

```typescript
// ✅ Good - reusable
const sendNotification: WorkflowDefinition<NotificationState> = {
  id: 'send-notification',
  // Can be used for any notification type
};

// ❌ Bad - too specific
const sendDeploymentSuccessEmailToJohn: WorkflowDefinition<...> = {
  // Hard-coded, not reusable
};
```

### 2. Use prepare() and toResult()

Transform data at workflow boundaries:

```typescript
{
  prepare: (params: unknown) => {
    const validated = schema.parse(params);
    return {
      ...validated,
      timestamp: new Date().toISOString()
    };
  },

  toResult: (state) => ({
    // Extract only what consumers need
    success: state.completed,
    data: state.output
  })
}
```

### 3. Handle Errors Gracefully

Use execute steps for error handling:

```typescript
{
  id: 'call-external-workflow',
  execute: async (state, ctx, services) => {
    try {
      const cmd = services.resolve('external-workflow');
      const result = await cmd.execute(state.params, ctx);
      return { ...state, result: result.data };
    } catch (error) {
      return { ...state, error: error.message, failed: true };
    }
  }
}
```

### 4. Document Workflow Dependencies

Use JSDoc to document what workflows/commands are required:

```typescript
/**
 * Multi-stage approval workflow
 *
 * @requires approval-workflow - Basic approval workflow
 * @requires notification-workflow - Email notification
 */
export const multiStageApproval: WorkflowDefinition<...> = {
  // ...
};
```

## Real-World Examples

See these files for production examples:

- **`hire-workflow.ts`** - Simple single-purpose workflow
- **`onboarding-workflow.ts`** - Complex multi-stage workflow using tool composition
- **`workflow-composition-example.ts`** - Example patterns for workflow composition

## Migration from Legacy Command Wrappers

Old pattern (verbose):

```typescript
export class MyWorkflowCommand implements ICommand {
  async execute(params, ctx) {
    const state = this.prepareState(params);
    const result = await new WorkflowRunner().run(myDefinition, state, { executionContext: ctx });
    return { status: 'ok', data: this.extractResult(result.state) };
  }
}
```

New pattern (concise):

```typescript
export const myWorkflow: WorkflowDefinition<MyState> = {
  id: 'my-workflow',
  prepare: (params) => this.prepareState(params),
  toResult: (state) => this.extractResult(state),
  steps: [
    /* ... */
  ],
};

// In registration:
const cmd = factory.asCommand(myWorkflow);
container.registerInstance('my-workflow', cmd);
```

## Testing Composable Workflows

Test workflows in isolation and in composition:

```typescript
describe('approval workflow', () => {
  it('should approve when user says yes', async () => {
    const factory = new WorkflowRunnerFactory(container);
    const cmd = factory.asCommand(approvalWorkflow);

    const result = await cmd.execute({ requestId: 'test-123' }, mockContext);

    expect(result.data.approved).toBe(true);
  });
});

describe('deploy workflow composition', () => {
  it('should call approval workflow before deploying', async () => {
    // Test that deploy workflow properly composes approval
    const spy = jest.spyOn(approvalCommand, 'execute');
    await deployWorkflow.run(/* ... */);
    expect(spy).toHaveBeenCalled();
  });
});
```

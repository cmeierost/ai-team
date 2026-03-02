# Auto-Generated API Documentation Approach

## Problem
- Don't want to define the API twice (once in code, once in docs)
- Documentation should be generated from the actual implementation
- JSDoc comments don't affect client bundles (they're just comments)

## Solution

### REST API (Swagger/OpenAPI)
**File:** `swagger-auto.ts` (**ACTIVE** - replaces old manual `swagger.ts`)

**How it works:**
1. Uses `swagger-jsdoc` (already installed) to parse JSDoc comments from route files
2. Add `@openapi` JSDoc blocks above each route handler
3. Spec is auto-generated at runtime from these comments

**Example - Annotated Route:**
```typescript
/**
 * @openapi
 * /api/agents:
 *   get:
 *     tags: [Agents]
 *     summary: List all agents
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
router.get('/', async (req, res, next) => {
  const agents = await client.listEmployees({});
  res.json(agents);
});
```

**Benefits:**
- Single source of truth: the route handler and its docs are together
- JSDoc comments are just comments - zero bundle impact
- swagger-jsdoc parses these automatically
- No duplicated type definitions

---

### WebSocket API (AsyncAPI)
**File:** `asyncapi.ts` + `scripts/generate-ws-schemas.mjs`

**How it works:**
1. **Build-time:** `typescript-json-schema` extracts schemas from TypeScript interfaces
2. Generates `dist/ws-schemas.json` during build
3. **Runtime:** `asyncapi.ts` loads pre-generated schemas and wraps with AsyncAPI metadata
4. The actual structure comes 100% from your TypeScript types

**Example - TypeScript Types (Source of Truth):**
```typescript
/**
 * Messages sent from client to server over WebSocket.
 * 
 * @example Send a chat message
 * ```json
 * { "type": "message", "content": "What tasks are assigned to me?" }
 * ```
 */
export interface ChatWebSocketMessage {
  /** Message type: 'message' = chat message, 'cancel' = abort, 'answer' = respond */
  type: 'message' | 'cancel' | 'answer';
  /** Chat message content (required for 'message' type) */
  content?: string;
  /** Additional options (optional for 'message' type) */
  options?: any;
  /** Answer to a question (required for 'answer' type) */
  answer?: {
    questionId: string;
    value: string | boolean | string[];
  };
}
```

**Build script:**
```json
"build": "tsc && node scripts/generate-ws-schemas.mjs"
```

**Benefits:**
- TypeScript types are the single source of truth
- Schemas generated at build time (no runtime overhead)
- JSDoc comments provide descriptions (also just comments, no bundle impact)
- Change the type = documentation updates on next build

---

## Migration Status

### ✅ Migration Complete!

**REST API (Swagger):**
- ✅ All route files now use `@openapi` JSDoc annotations
- ✅ `server.ts` imports from `swagger-auto.ts` (not old `swagger.ts`)
- ✅ 32 documented endpoints with 38 operations:
  - GET: 18 operations
  - POST: 14 operations
  - PATCH: 4 operations
  - PUT: 1 operation
  - DELETE: 1 operation

**WebSocket API (AsyncAPI):**
- ✅ Build-time schema generation using `typescript-json-schema`
- ✅ Schemas extracted from `ws/chat-handler.ts` types
- ✅ JSDoc comments provide descriptions
- ✅ Server serves both `/asyncapi` (HTML UI) and `/asyncapi.json` (spec)

**Annotated Routes:**
- ✅ `routes/agents.ts` - 2 endpoints (list, get by ID)
- ✅ `routes/team.ts` - 1 endpoint (team graph)
- ✅ `routes/chat.ts` - 8 endpoints (summaries, history, send, edit, delete, archive, unarchive, annotate, stats, create summary)
- ✅ `routes/sessions.ts` - 10 endpoints (create, list, get, messages, split, summarize, handoff, merge, update, add agents)
- ✅ `routes/tasks.ts` - 9 endpoints (create, list, get, update, templates, dashboard, hierarchy, split, delegate, log time)
- ✅ `routes/sessions.ts` (artifacts) - 2 endpoints (list artifacts, get artifact by ID)
- ✅ `server.ts` - 1 endpoint (health check)

---

## Current Documentation URLs

When server is running on `http://localhost:3002`:

- **`/api-docs`** - REST API Swagger UI (interactive documentation)
- **`/api-docs.json`** - REST API OpenAPI 3.0 JSON spec
- **`/asyncapi`** - WebSocket API AsyncAPI UI (interactive documentation)
- **`/asyncapi.json`** - WebSocket API AsyncAPI 2.6.0 JSON spec

---

## Key Benefits of This Approach

1. **Single Source of Truth:** Code IS the documentation
2. **No Bundle Impact:** JSDoc comments are stripped by bundlers automatically
3. **Type Safety:** TypeScript types drive the docs
4. **Auto-sync:** Change code = docs update automatically
5. **Standard Tools:** Uses `swagger-jsdoc` and `typescript-json-schema` (mature libraries)
6. **Build-time Generation:** WebSocket schemas built once, not on every request

---

## Files Changed

**Created:**
- **packages/api-server/src/swagger-auto.ts** - Auto-generated Swagger using JSDoc
- **packages/api-server/scripts/generate-ws-schemas.mjs** - Build script for WebSocket schemas
- **packages/api-server/src/asyncapi.test.ts** - Tests for AsyncAPI generation

**Updated:**
- **packages/api-server/package.json** - Added `@asyncapi/parser`, `typescript-json-schema`; updated build script
- **packages/api-server/src/asyncapi.ts** - Loads pre-generated schemas at runtime
- **packages/api-server/src/ws/chat-handler.ts** - Added JSDoc comments to interfaces
- **packages/api-server/src/routes/agents.ts** - Added `@openapi` annotations
- **packages/api-server/src/routes/team.ts** - Added `@openapi` annotations
- **packages/api-server/src/routes/chat.ts** - Added `@openapi` annotations
- **packages/api-server/src/routes/sessions.ts** - Added `@openapi` annotations
- **packages/api-server/src/routes/tasks.ts** - Added `@openapi` annotations
- **packages/api-server/src/server.ts** - Changed import to `swagger-auto.ts`; added AsyncAPI endpoints; added health check docs

**Obsolete (can be removed):**
- **packages/api-server/src/swagger.ts** - Old manual spec (no longer imported)

---

## Adding New Endpoints

### For REST endpoints:
Add `@openapi` JSDoc block above the route handler:

```typescript
/**
 * @openapi
 * /api/myroute/{id}:
 *   post:
 *     tags: [MyFeature]
 *     summary: Create something
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/:id', async (req, res) => {
  // implementation
});
```

### For WebSocket message types:
1. Add/update TypeScript interface in `ws/chat-handler.ts`
2. Add JSDoc comment with description
3. Rebuild: `pnpm --filter @ai-team/api-server build`
4. Schemas auto-regenerate

---

## Testing

### Build:
```bash
pnpm --filter @ai-team/api-server build
# Output: ✓ Generated WebSocket schemas at dist/ws-schemas.json
```

### Run:
```bash
$env:AI_TEAM_WORKSPACE='C:\Projects\ai-team'
node packages/api-server/dist/index.js
```

### Verify:
```bash
# Check endpoint count
$response = Invoke-WebRequest -Uri 'http://localhost:3002/api-docs.json'
$spec = $response.Content | ConvertFrom-Json
$spec.paths.PSObject.Properties.Count  # Should be 32

# Check WebSocket schemas
Get-Content packages\api-server\dist\ws-schemas.json
```

---

## Decorator Approach (Alternative - NOT USED)

If you want TypeScript decorators instead of JSDoc:

**Pros:**
- More "code-like" feel
- Type-safe decorator parameters
- Popular in NestJS, tsoa

**Cons:**
- Requires `experimentalDecorators: true` in tsconfig
- Adds runtime overhead (small)
- More complex build setup
- Would need transformer to strip from client builds

**Our Choice:** Stick with JSDoc - it's simpler and has zero runtime cost.

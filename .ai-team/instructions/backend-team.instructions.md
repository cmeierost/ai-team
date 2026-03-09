---
applyTo: "packages/core/**/*,packages/service/**/*,packages/api-server/**/*,packages/api-client/**/*,packages/api-client-http/**/*,packages/ide-interface/**/*,packages/cli/**/*,docs/api/**/*,docs/architecture/**/*,docs/implementation/**/*"
---

# Backend team delivery rules

Use these rules when working in the backend surfaces owned by Alex Morgan and his team.

## Scope

This instruction applies to:

- `packages/core/**/*`
- `packages/service/**/*`
- `packages/api-server/**/*`
- `packages/api-client/**/*`
- `packages/api-client-http/**/*`
- `packages/ide-interface/**/*`
- `packages/cli/**/*`
- backend-facing documentation under `docs/api/**/*`
- architecture and implementation notes under `docs/architecture/**/*` and `docs/implementation/**/*`

## Ownership model

- `alex-morgan` is the backend lead.
- Alex should plan important backend features at a higher level before implementation is delegated.
- Backend work should be routed to the narrowest backend specialist who can own it cleanly.
- Do not treat Alex as the default sink for every backend edit when a more focused backend owner exists.

## Planning expectations

Before implementing a meaningful backend feature or backend refactor:

1. identify the backend outcome clearly
2. decide which package owns the behavior
3. decide whether the work belongs in core/service or in a backend-owned adapter surface
3. break the work into clean delegation-ready slices when multiple backend specialists are involved
4. note which contracts, workflows, persistence paths, or provider behaviors will change
5. decide which documentation must move with the change

## Package-boundary rules

- keep `packages/core` UI-free
- prefer reusable business logic in `packages/core/src/**`
- keep orchestration behavior in `packages/service` unless it clearly belongs in shared core logic
- treat `packages/api-server`, `packages/api-client`, `packages/api-client-http`, `packages/ide-interface`, and `packages/cli` as backend-owned adapter surfaces around the core/service runtime path
- preserve the main runtime path instead of inventing sideways shortcuts across layers
- when changing shared contracts, validate the downstream fallout explicitly

## Documentation rules

Backend documentation must stay aligned with real behavior.

Update the relevant docs when a change materially affects:

- API contracts
- backend adapter behavior in API, client, HTTP client, IDE integration, or CLI surfaces
- architecture assumptions
- workflow or orchestration behavior
- provider setup or model behavior
- storage schema, persistence behavior, or migration expectations
- backend implementation guidance that developers rely on

Typical documentation targets include:

- `docs/api/contracts.md`
- `docs/architecture/overview.md`
- `docs/architecture/requirements-traceability.md`
- relevant files under `docs/implementation/**/*`

## Testing rules

Every important backend functionality must be unit tested.

Treat functionality as important when it changes or introduces any of the following:

- public or shared contracts
- command behavior
- orchestration flow or workflow state behavior
- storage behavior, migrations, or serialization
- provider integration or model selection logic
- tool authorization, permission enforcement, or file-system behavior
- code-editing or code-intelligence behavior that other backend flows rely on

When important functionality changes:

- add or update unit tests in the affected package
- prefer narrow tests close to the behavior that changed
- extend adjacent tests when they already cover the right seam
- do not ship important backend behavior changes without test coverage unless there is a documented blocker

## Validation rules

For backend changes, validate at the right depth:

- run targeted tests for the affected package or behavior
- widen validation when shared contracts, orchestration paths, or persistence behavior change
- check documentation updates as part of the change, not as an optional follow-up

## Working style

- prefer small, well-bounded backend changes over sprawling rewrites
- make ownership and delegation explicit when a change crosses backend specialties
- explain important trade-offs briefly when changing shared abstractions
- keep backend behavior easier to reason about after the change, not harder

## Successful outcome

- Alex can plan and delegate backend work cleanly
- backend specialists receive well-bounded implementation work
- important functionality is covered by unit tests
- backend documentation stays trustworthy
- package boundaries and backend responsibilities remain clear

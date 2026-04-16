---
id: plan-explicit-user-triggered-tool-mcp-an
type: feature
title: Plan explicit user-triggered tool, MCP, and CLI execution surface
createdBy: human
createdByType: human
parentPlanId: transition-service-boundaries-away-from-
status: not_started
priority: medium
requiresApproval: false
estimatedHours: 10
tags:
  - architecture
  - tools
  - mcp
  - cli
  - future
metadata:
  plannedFeature: true
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z
deadline: null
assignedTo: ethan-carter

------

## Why this exists

A future UI feature should allow the user to explicitly trigger tool, MCP, or CLI execution without pretending that every such action is just another chat turn.

## Current decision

- [ ] acknowledge this feature in the architecture now
- [ ] do not implement it during the current stabilization work
- [ ] let it influence interface naming so we do not paint ourselves into a tiny architectural corner

## Expected design direction

- [ ] a dedicated service surface for explicit user-triggered execution
- [ ] shared policy and execution infrastructure where that still makes sense
- [ ] room for different policy handling between model-initiated and user-initiated actions

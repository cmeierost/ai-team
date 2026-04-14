---
id: fix-cli-argument-handling-and-help-fallb
type: bug
title: Fix CLI argument handling and help fallback
status: todo
priority: medium
createdBy: human
createdByType: human
requiresApproval: false
subPlanIds: []
estimatedHours: null
deadline: null
tags:
  - cli
  - bug
createdAt: 2026-04-13T00:00:00.000Z
updatedAt: 2026-04-13T00:00:00.000Z
assignedTo: ethan-carter

------

## Goal

Improve the CLI argument handling and fallback behaviors in the `@ai-team/cli` package. Currently, certain flags like `ait -v` are not working, and commands that require further arguments (like `ait provider`) fail silently instead of displaying the help menu.

## Action Items

- [ ] Implement or fix the `-v` and `--version` flags to correctly output the CLI version.
- [ ] Update command definitions (such as `ait provider`) to automatically show the help text if required positional arguments or subcommands are missing.
- [ ] Review other CLI commands to ensure missing argument scenarios gracefully fail with a helpful error message or help text.
- [ ] Add tests to verify version flags and missing argument help fallbacks work as expected.

---
id: fix-accessible-file-viewer
type: bug
title: Fix accessible file viewer showing 0 readable/listable/writable files
status: todo
priority: high
createdBy: human
createdByType: human
requiresApproval: false
subtaskIds: []
estimatedHours: null
deadline: null
tags:
  - bug
createdAt: 2026-04-13T00:00:00.000Z
updatedAt: 2026-04-13T00:00:00.000Z
---

## Goal

Fix the accessible file viewer. Currently, it always shows that there are 0 readable, listable, or writable files available, preventing users from seeing or accessing files correctly.

## Action Items

- [ ] Investigate the root cause of the file viewer returning 0 files.
- [ ] Check the file system context or permission boundaries (e.g., `fs-context/src/permission/`) to see if file access is being improperly blocked.
- [ ] Implement the fix to accurately list and display readable, listable, and writable files.
- [ ] Add or update tests to verify that the file viewer displays the correct file counts and grants appropriate access.

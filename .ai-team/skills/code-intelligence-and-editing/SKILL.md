---
name: code-intelligence-and-editing
description: 'Use when working on AST analysis, tree-sitter parsing, symbol or complexity inspection, diff generation, structured edit proposals, or code-aware backend editing workflows.'
---

# Code intelligence and editing

Use this skill when the backend work touches code analysis, syntax-aware inspection, or structured editing behavior.

Typical triggers:

- TypeScript AST analysis needs expansion or fixes
- tree-sitter initialization or grammar handling changes
- symbol, reference, or complexity analysis needs work
- diff generation or edit proposal validation changes
- code-aware tooling should become safer or more capable

## Focus areas

- `packages/core/src/code-analysis/**/*`
- `packages/core/src/code-edit/**/*`
- code-aware tool integrations in `packages/core/src/tools/**/*`

## Workflow

1. Identify whether the task is AST-based analysis, parser management, diff/edit proposal handling, or tool integration.
2. Keep syntax-aware logic separate from plain text search when the distinction matters.
3. Prefer predictable structured output over clever but opaque heuristics.
4. Validate with realistic TypeScript code shapes and edge cases.

## Guardrails

- do not blur plain text matching and structured code analysis without being explicit
- do not ship parser or diff behavior that is hard to debug
- keep edit proposal safety checks intact when expanding capabilities
- prefer incremental support for new analysis paths over sprawling abstractions

## Successful outcome

- code-aware backend features become more reliable and easier to extend
- AST, tree-sitter, and diff logic stay understandable
- structured editing remains safer than ad-hoc text mutation

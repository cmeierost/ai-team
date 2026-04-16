# Documents Concept (Step A: Terminology Alignment)

This note defines a single shared term for user-facing artifacts.

## Canonical term

Use **Document** as the canonical product term.

- In UI/product language: **Document**
- In existing runtime contracts/code: **Artifact** (kept for compatibility)

## Why

Today we use multiple overlapping words (`note`, `link`, `file`, `brief`, `summary`).
They all represent the same core idea: shareable knowledge outputs produced from sessions and reused across tasks.

Unifying on **Document** reduces ambiguity in planning, UX wording, and cross-team communication.

## Alias mapping (current → canonical)

- `brief` → Document subtype
- `summary` → Document subtype
- `record` → Document subtype
- `note` → Document annotation or lightweight document
- `link` → Document reference
- `file` → Document storage representation
- `artifact` → technical/runtime name for a Document

## Scope of Step A

Step A is vocabulary alignment only.

No runtime schema or API behavior changes are required in this step.

## Naming guidance

- User-facing text (web/CLI/docs): prefer **Document(s)**
- Type names and wire contracts: keep `Artifact` for now unless a migration is explicitly approved
- Use subtype labels where needed (`brief`, `summary`, `record`, `document`)

## Next steps

1. Add a thin glossary line in `docs/api/contracts.md` that `Artifact` is the runtime contract name for a Document.
2. Inventory user-facing strings that currently say `artifact`, `brief`, or `summary` when they mean the generic concept.
3. (Optional) Plan a separate migration if renaming `Artifact` in code/contracts is desired later.

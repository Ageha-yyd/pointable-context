---
name: pointable-context-records
description: Create or update evidence-bound Pointable Context Task and Verification records in an explicit local workspace. Use when the user asks to preserve a stable development status or an actually observed verification result for later selection-based lookup. Do not trigger for transient reasoning, ordinary TODOs, static test definitions, or merely because work files changed.
---

# Pointable Context Work Result Records

Persist only stable, user-relevant work results that will save a later reader from reconstructing project state from a long Chat Lane. These records feed Quiet Context Reveal; they are not a Dashboard or a substitute for project management.

## Preconditions

1. Require one explicit local workspace in scope. Never write to the bundled fixture or infer another repository.
2. Confirm that the requested status or result was actually established in the current work. If it is uncertain, keep working or write the uncertainty as the result; do not upgrade it to completion or PASS.
3. Search the frozen target directory for an existing stable identity. Update it instead of creating a near-duplicate.
4. Preserve unrelated workspace changes and use normal repository editing rules.

## Task record

Use `docs/tasks/<stable-name>.md` only for a status that is likely to be referenced later. Require exactly these H2 sections:

- `目标`
- `当前状态`
- `已完成`
- `下一步`
- `阻塞`
- `更新时间`
- `证据`
- `来源`

Write `更新时间` as ISO 8601 with an explicit timezone. `阻塞` must be explicit, including `无` when appropriate. The evidence excerpt must exactly equal one bounded line in the workspace-relative `来源` path.

## Verification record

Use `docs/verifications/<stable-name>.md` only after an actual command, review, or human acceptance produced an observed result. Require exactly these H2 sections:

- `要证明什么`
- `结果`
- `尚未证明`
- `验证方式`
- `验证修订`
- `执行时间`
- `证据`
- `来源`

Write `执行时间` as ISO 8601 with an explicit timezone. Identify the verified commit or bounded dirty-worktree snapshot honestly. Record PASS, FAIL, partial, or inconclusive as observed; every positive result must still name the boundary it did not prove. Copy one bounded result line into a workspace evidence file when the original output is ephemeral, then cite that exact relative path and line.

## Hard boundaries

- Never infer task completion from Chat prose, a commit, file existence, or TODO removal.
- Never infer PASS/FAIL from `*.test.*`, `*.spec.*`, test titles, or a command that was not actually run.
- Never invent a verified revision, execution time, owner, evidence line, or user acceptance.
- Do not create a record for every turn or file. Prefer one stable record per user-recognizable task or verification question.
- Do not call a model to semantically mine candidates or add a visible capsule. The workspace companion indexes valid records on demand; UI remains user-pulled.
- If the evidence line later drifts, let lookup fail closed until the record is deliberately refreshed.

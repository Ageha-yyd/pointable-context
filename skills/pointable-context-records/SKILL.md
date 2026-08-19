---
name: pointable-context-records
description: Create, update, and validate evidence-bound Pointable Context Task and Verification records in an explicit local workspace. Use for a one-shot explicit record request or when the user explicitly opts a bounded long-running task into milestone record maintenance. Do not trigger for transient reasoning, ordinary TODOs, static test definitions, or merely because work files changed.
---

# Pointable Context Work Result Records

Persist only stable, user-relevant work results that will save a later reader from reconstructing project state from a long Chat Lane. These records feed Quiet Context Reveal; they are not a Dashboard or a substitute for project management.

## Preconditions

1. Require one explicit local workspace in scope. Never write to the bundled fixture or infer another repository.
2. Require one of two opt-in modes:
   - a one-shot request to create or update a named record; or
   - an explicit request to maintain Pointable Context records for the current bounded task. This authorization ends when the task, workspace, or requested scope changes.
3. Confirm that the requested status or result was actually established in the current work. If it is uncertain, keep working or write the uncertainty as the result; do not upgrade it to completion or PASS.
4. Search both frozen target directories for an existing stable identity. Update it instead of creating a near-duplicate.
5. Preserve unrelated workspace changes and use normal repository editing rules.

## Qualification policy

Create or update a record only when all four conditions hold:

1. It has a stable, user-recognizable identity that can be selected later.
2. It is likely to be referenced after the current Chat Turn.
3. It materially changes the next decision, task status, handoff state, or records an actually observed verification.
4. One exact, bounded evidence line exists in the explicit workspace.

Qualifying milestones include a user-visible deliverable, a task or Gate state change, an actual command/review/human acceptance result, and a handoff or deliberate stop point. Prefer updating the existing identity. Normally create no more than one new Task record and one new Verification record for a single milestone.

Do not record intermediate reasoning, routine file edits, planned tests, ordinary TODOs, repeated progress narration, or facts that are already easier to read from the selected source file itself.

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

## Required post-write check

After any create or update operation, run the bundled read-only checker against the explicit workspace. Locate this Skill's absolute catalog path and resolve the Plugin root two directories above the Skill folder:

```powershell
$skillFile = 'ABSOLUTE_PATH_TO_THIS_SKILL.md'
$pluginRoot = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $skillFile) '..\..')).Path
$checker = Join-Path $pluginRoot 'dist\src\records\check-cli.js'
node $checker --workspace-root 'ABSOLUTE_WORKSPACE_PATH' --json
```

The check must report `valid: true` before the record is treated as indexable. It validates only frozen Task/Verification directories, strict structure and time fields, exact evidence, and cross-type stem uniqueness. It never repairs a record. On failure, report the bounded issue code and leave the invalid record out of the usable Context Index.

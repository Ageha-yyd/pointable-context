---
name: pointable-context-records
description: Create, update, and validate evidence-bound Pointable Context Concept, Change, Decision, Task, and Verification milestone artifacts in an explicit local workspace. Use for a one-shot explicit artifact request or when the user explicitly opts a bounded long-running task into milestone context maintenance. Do not trigger for transient reasoning, ordinary TODOs, static test definitions, implicit concepts, or merely because work files changed.
---

# Pointable Context Milestone Artifacts

Persist only stable, user-relevant context that will save a later reader from reconstructing project state from a long Chat Lane. These artifacts feed Quiet Context Reveal; they are not a Dashboard or a substitute for project management.

## Preconditions

1. Require one explicit local workspace in scope. Never write to the bundled fixture or infer another repository.
2. Require one of two opt-in modes:
   - a one-shot request to create or update a named record; or
   - an explicit request to maintain Pointable Context records for the current bounded task. This authorization ends when the task, workspace, or requested scope changes.
3. Confirm that the requested status or result was actually established in the current work. If it is uncertain, keep working or write the uncertainty as the result; do not upgrade it to completion or PASS.
4. Search all five frozen target directories for an existing stable identity. Update it instead of creating a near-duplicate.
5. Preserve unrelated workspace changes and use normal repository editing rules.

## Qualification policy

Create or update an artifact only when all four conditions hold:

1. It has a stable, user-recognizable identity that can be selected later.
2. It is likely to be referenced after the current Chat Turn.
3. It materially changes the next decision, task status, handoff state, or records an actually observed verification.
4. One exact, bounded evidence line exists in the explicit workspace.

Qualifying milestones include a stable concept introduced by the completed work, a material before/after change, an explicit decision, a user-visible deliverable, a task or Gate state change, an actual command/review/human acceptance result, and a handoff or deliberate stop point. Prefer updating the existing identity. Normally create no more than one explanatory artifact (Concept, Change, or Decision), one Task record, and one Verification record for a single milestone.

Do not record intermediate reasoning, routine file edits, planned tests, ordinary TODOs, repeated progress narration, implicit concepts, or facts that are already easier to read from the selected source file itself.

## Explanatory milestone artifacts

Use an explanatory artifact only when the stable identity is likely to appear in later Chat and cannot already be understood from a normal file/module card. The normalized file stem must equal the H1 identity so the visible term and deterministic lookup name cannot drift.

- `docs/concepts/<stable-name>.md`: exactly `它是什么意思`, `为什么现在出现`, `它不是什么`, `所处流程`, `证据`, `来源`. The flow has 2–4 bullet items and exactly one `当前：` item.
- `docs/changes/<stable-name>.md`: exactly `原来怎样`, `现在怎样`, `影响什么`, `证据`, `来源`.
- `docs/decisions/<stable-name>.md`: exactly `为什么需要决定`, `选择了什么`, `后果是什么`, `证据`, `来源`.

Do not use another managed Concept, Change, Decision, Task, or Verification artifact as the evidence source. Cite one bounded line in the underlying PRD, source documentation, command evidence, review output, or human-acceptance evidence file. Never infer an implicit decision or create a concept merely because a noun appeared in Chat.

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

## Required post-write checks

After any create or update operation, run the applicable bundled read-only checkers against the explicit workspace. Locate this Skill's absolute catalog path and resolve the Plugin root two directories above the Skill folder:

```powershell
$skillFile = 'ABSOLUTE_PATH_TO_THIS_SKILL.md'
$pluginRoot = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $skillFile) '..\..')).Path
$checker = Join-Path $pluginRoot 'dist\src\records\check-cli.js'
$artifactChecker = Join-Path $pluginRoot 'dist\src\records\artifact-check-cli.js'
node $checker --workspace-root 'ABSOLUTE_WORKSPACE_PATH' --json
node $artifactChecker --workspace-root 'ABSOLUTE_WORKSPACE_PATH' --json
```

Each applicable check must report `valid: true` before the artifact is treated as indexable. The record checker validates frozen Task/Verification directories, strict structure and time fields, exact evidence, and cross-type stem uniqueness. The artifact checker validates frozen Concept/Change/Decision directories, exact section order, file/H1 identity, exact non-circular evidence, and cross-type stem uniqueness. Neither checker repairs an artifact. On failure, report the bounded issue code and leave the invalid artifact out of the usable Context Index.

## Long-task coverage audit

When the user has explicitly opted a bounded long task into record maintenance, keep a small `docs/context-coverage.json` declaration of the Module, Decision, Task, and Verification objects that must remain recoverable at the current milestone. Do not populate it by mining Chat or guessing importance. Each expected entry must have exactly `id`, `kind`, and workspace-relative `key`; `kind` is one of `module`, `decision`, `task`, or `verification`.

After a stable milestone or before handoff, run the bundled read-only coverage gate:

```powershell
$coverage = Join-Path $pluginRoot 'dist\src\records\coverage-cli.js'
node $coverage --workspace-root 'ABSOLUTE_WORKSPACE_PATH' --json
```

Interpret the measures conservatively:

- `coverageRate`: declared objects that were indexed and returned a verified detail snapshot;
- `omissionRate`: declared objects with no matching workspace identity;
- `projectionFailureRate`: declared objects present under the wrong type, invalid schema/evidence, or temporarily unreadable;
- `redundancyRate`: duplicate Task/Verification record files divided by discovered record candidates.

This is structural coverage of an explicit declaration, not proof that every important concept in the project was captured. A missing declaration cannot be discovered by this deterministic gate. Never expose file contents in the audit result, and never treat a failed audit as permission to synthesize or silently repair records.

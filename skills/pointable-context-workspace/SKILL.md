---
name: pointable-context-workspace
description: Start, inspect, bind, or stop the opt-in Pointable Context live local-workspace companion for Codex Desktop. Use only when the user explicitly asks to manage the workspace companion, bind the current Codex task to a local workspace, or troubleshoot its selection Quick Look. Do not trigger for ordinary text selection, copying, generic project questions, or fixture MCP lookups.
---

# Pointable Context Workspace

Manage the private Codex Desktop companion that turns an explicitly selected file identity in a Chat Lane message into a read-only local-workspace Quick Look.

## Boundaries

- Treat this as an experimental, Codex-specific CDP Host Adapter, not a portable public Codex or MCP Apps contract.
- Keep ordinary selection inert. Query only after the user clicks `查看工作区上下文` or uses its trusted keyboard action.
- Bind only the one task currently vouched by the host to one explicit absolute workspace root. Never infer another task, root, project ID, Dashboard, DCPM, or CWA context.
- Read only exact bounded file identities and live file metadata/content. Do not write workspace files through the companion.
- Do not use the fixture MCP tools for live workspace results. Fixture results remain demonstration data.

## Locate the companion

Read this Skill's absolute path from the active skill catalog. Resolve the plugin root two directories above the skill folder, then use its bundled `host/workspace-companion.mjs`. Fail closed if that file is missing.

PowerShell example, replacing the first value with the catalog path:

```powershell
$skillFile = 'ABSOLUTE_PATH_TO_THIS_SKILL.md'
$pluginRoot = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $skillFile) '..\..')).Path
$companion = Join-Path $pluginRoot 'host\workspace-companion.mjs'
```

## Workflow

1. Run `status --json` first. Reuse a healthy running companion; do not start a duplicate.
2. Run `start --json` only after an explicit user request to enable the companion.
3. Before binding, require an explicit absolute workspace root or an unambiguous user reference to the current workspace root exposed by the host. Canonicalization and existence checks happen in the companion.
4. Run `bind --workspace-root <absolute-path> --json`. Binding must fail unless exactly one Codex task is currently host-visible. Never bind a different task silently.
5. Read back `status --json`. Report mode, process state, target count, active task count, and `activeBinding` root/revision without exposing the control token. A later explicit `bind` reports `replaced: true` when it rebinds that task.
6. Ask the user to select an exact visible file name/path, such as `README.md`, and click `查看工作区上下文`. A unique exact match opens detail directly; ambiguity presents bounded candidates.
7. Run `unbind --json` only when explicitly requested. Verify that `activeBinding` disappears before binding another root.
8. Run `stop --json` when requested. Stopping removes the renderer and runtime binding but intentionally preserves the explicit task-to-workspace registry for later reuse/rebinding.

```powershell
node $companion status --json
node $companion start --json
node $companion bind --workspace-root 'D:\absolute\workspace' --json
node $companion unbind --json
node $companion stop --json
```

## Fail closed

- If status reports no target, ask the user to open Codex Desktop with its local CDP endpoint available; do not weaken target or origin checks.
- If binding reports zero or multiple active tasks, ask the user to focus exactly one task and retry.
- If a selected term has no exact file identity, leave Chat/copy behavior unchanged; do not send arbitrary selected prose to a model for semantic guessing.
- If task, route, workspace root, binding revision, selection digest, or renderer generation drifts, discard the result and require a fresh explicit action.
- Present `current` only when the card reports `live_read` with a verified revision. Preserve stale/unavailable states as returned.

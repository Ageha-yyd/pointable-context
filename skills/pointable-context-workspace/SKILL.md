---
name: pointable-context-workspace
description: Enable, inspect, bind, or stop Pointable Context Quiet Mode for an explicit local workspace in Codex Desktop. Use only when the user explicitly asks to manage the workspace companion, bind the current Codex task, or troubleshoot its selection-triggered context reveal. Do not trigger for ordinary selection, copying, generic workspace questions, or fixture MCP lookups.
---

# Pointable Context Workspace Quiet Mode

Manage the private Codex Desktop companion that keeps normal Chat visually unchanged until the user selects a deterministic file identity and explicitly clicks `查看上下文`.

## Product contract

- Selection alone is inert: no workspace read, Provider call, model call, or Chat Turn.
- The only recognizers are exact bounded file name/path and deterministic workspace alias rules.
- There is no `识别更多概念`, semantic model, embedding search, or automatic Chat fallback.
- One exact match opens detail directly after the click; 2–3 matches show candidates; broader/mixed results fail closed.
- Detail is read-only, current, type-specific, and displayed beside the selection.
- A Markdown document detail prioritizes `用途`, `本次变化`, `影响范围`, `Git 状态`, and `路径`. These fields come from bounded file structure, Git, and literal references, never a model.

## Boundaries

- Treat this as an experimental Codex-specific CDP Host Adapter, not a portable public MCP Apps contract.
- Bind only the one host-vouched task to one explicit absolute workspace root. Never infer another task, root, Dashboard, DCPM, or CWA context.
- Read only exact bounded file identities and live file metadata/content. Do not write workspace files through the companion.
- Do not use fixture MCP tools for live workspace results.
- Do not replace this route with the browser App Server harness.

## Locate the companion

Read this Skill's absolute path from the active skill catalog. Resolve the plugin root two directories above the skill folder, then use its bundled `host/workspace-companion.mjs`. Fail closed if that file is missing.

```powershell
$skillFile = 'ABSOLUTE_PATH_TO_THIS_SKILL.md'
$pluginRoot = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $skillFile) '..\..')).Path
$companion = Join-Path $pluginRoot 'host\workspace-companion.mjs'
```

## Workflow

1. Run `status --json` first. Reuse a healthy running companion; do not start a duplicate.
2. Run `start --json` only after an explicit user request to enable Quiet Mode.
3. Require an explicit absolute workspace root or an unambiguous current workspace root exposed by the host.
4. Run `bind --workspace-root <absolute-path> --json`. Binding must fail unless exactly one Codex task is host-visible.
5. Read back `status --json`. Report mode, process state, target count, active task count, and `activeBinding` root/revision without exposing the control token.
6. Ask the user to select an exact visible file name/path, such as `README.md`, and click `查看上下文`.
7. Verify that selection alone produces no detail request; the trusted click produces one direct detail or a bounded candidate menu.
8. Run `unbind --json` only when explicitly requested. Verify that `activeBinding` disappears before binding another root.
9. Run `stop --json` when requested. Stopping removes the renderer/runtime binding but intentionally preserves the explicit task-to-workspace registry for later reuse.

```powershell
node $companion status --json
node $companion start --json
node $companion bind --workspace-root 'D:\absolute\workspace' --json
node $companion unbind --json
node $companion stop --json
```

## Fail closed

- If no target is visible, ask the user to open Codex Desktop with its local CDP endpoint available; do not weaken target/origin checks.
- If binding sees zero or multiple active tasks, ask the user to focus exactly one task and retry.
- If selected text has no exact file identity, leave Chat/copy behavior unchanged; do not send it to a model.
- If task, route, workspace root, binding revision, selection digest, renderer generation, index, or Provider drifts, discard the result and require a fresh explicit action.
- Present `current` only for a verified live read. Preserve stale/unavailable states exactly as returned.
- Treat `影响范围` as bounded literal reference evidence, not a semantic dependency or impact claim. Preserve `Git 状态: unavailable` when the workspace is not a qualifying Git root.

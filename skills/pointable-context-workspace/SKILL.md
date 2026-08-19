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
- A TypeScript/JavaScript module detail prioritizes `职责`, `公开入口`, `本次变化`, `依赖与影响`, and `路径`. These fields come from bounded source declarations, static imports, Git, and literal test/importer references; source is never executed.
- A test/spec source detail prioritizes detected static test titles and always states that the card did not execute the tests. Never translate source presence into PASS/FAIL.
- A known JSON configuration detail shows purpose and bounded top-level key names only. Never expose configuration values or potential secrets in the card.
- A path-qualified ADR/decision Markdown detail reads only explicit Status, Decision, Context/Rationale, and Consequences sections.
- An explicitly authored `docs/concepts/*.md` artifact may expose meaning, current context, boundary, a bounded process, and a verified workspace evidence line. Do not infer the same structure from ordinary prose.
- The card is summary-first: facts, revision, observed time, and sources remain inside a collapsed in-card `查看详情` disclosure. Keep type and freshness visible even while collapsed.
- Use `mental-model` as the ordinary product default. Presentation studies may explicitly fix `record`, `narrative`, or `mental-model` at startup. Never add an in-card condition switch. The mental-model condition keeps evidence behind the local `为什么这样说` disclosure.
- An open card pins its snapshot. A lightweight file-stat revision probe may show `内容已更新`; only a trusted `刷新内容` click may re-read full detail, update the same card, and expose at most three changed fields. This creates no model call or Chat Turn.
- If the selected file is deleted or revision status is unavailable, keep the old snapshot visible with an explicit warning. Never silently replace, hide, or relabel it as current.

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

1. Run `status --json` first. Reuse a running companion only when `compatibility.state` is `qualified`; do not start a duplicate.
2. Run `start --json` only after an explicit user request to enable Quiet Mode. This starts the ordinary `mental-model` default. For a frozen concept-presentation study, pass the assigned `--presentation-mode <record|narrative|mental-model>` instead.
3. Require an explicit absolute workspace root or an unambiguous current workspace root exposed by the host.
4. Run `bind --workspace-root <absolute-path> --json`. Binding must fail unless exactly one Codex task is host-visible.
5. Read back `status --json`. Report mode, process state, `compatibility.state/code`, target count, active task count, and `activeBinding` root/revision without exposing the control token.
6. Ask the user to select an exact visible file name/path, such as `README.md`, and click `查看上下文`.
7. Verify that selection alone produces no detail request; the trusted click produces one direct detail or a bounded candidate menu.
8. For revision qualification, leave one card open, change the selected file, confirm `内容已更新`, then click `刷新内容`. Verify that the card updates in place, displays a finite diff, opens no browser, and adds no Chat Turn.
9. Run `unbind --json` only when explicitly requested. Verify that `activeBinding` disappears before binding another root.
10. Run `stop --json` when requested. Stopping removes the renderer/runtime binding but intentionally preserves the explicit task-to-workspace registry for later reuse.

```powershell
node $companion status --json
node $companion start --json
node $companion start --presentation-mode mental-model --json
node $companion bind --workspace-root 'D:\absolute\workspace' --json
node $companion unbind --json
node $companion stop --json
```

## Fail closed

- If no target is visible, ask the user to open Codex Desktop with its local CDP endpoint available; do not weaken target/origin checks.
- Treat `compatibility.state=unavailable` as a host that could not be checked and `compatibility.state=incompatible` as a private host-contract mismatch. Do not bind, inject a fallback selector, or describe either state as qualified.
- If binding sees zero or multiple active tasks, ask the user to focus exactly one task and retry.
- If selected text has no exact file identity, leave Chat/copy behavior unchanged; do not send it to a model.
- A concept without a strict `docs/concepts/*.md` identity is still a no-match. A missing section, current step, source line, or exact evidence match must fail closed.
- If task, route, workspace root, binding revision, selection digest, renderer generation, index, or Provider drifts, discard the result and require a fresh explicit action.
- Treat the current lightweight revision probe as source-file-stat evidence only. Do not claim it detects relation-only or Git-only drift.
- Present `current` only for a verified live read. Preserve stale/unavailable states exactly as returned.
- Treat Markdown `影响范围` and module `依赖与影响` as bounded literal evidence, not a semantic dependency or runtime impact claim. Preserve explicit Git-unavailable wording when the workspace is not a qualifying Git root.

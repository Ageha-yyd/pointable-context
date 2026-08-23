---
name: pointable-context-workspace
description: Enable, inspect, bind, or stop Pointable Context Quiet Mode for an explicit local workspace in Codex Desktop, including sparse task-local dynamic objects. Use only when the user explicitly asks to manage the workspace companion, bind the current Codex task, maintain its Pointable Context object layer, or troubleshoot context reveal. Do not trigger for ordinary selection, copying, generic workspace questions, or fixture MCP lookups.
---

# Pointable Context Workspace Quiet Mode

Manage the private Codex Desktop companion that keeps normal Chat visually unchanged until the user clicks a quiet registered-object mark or selects a deterministic identity and explicitly clicks `查看上下文`.

## Product contract

- Selection alone is inert: no workspace read, Provider call, model call, or Chat Turn.
- The only recognizers are exact registered keys/names/aliases, bounded file name/path, and deterministic workspace alias rules.
- There is no `识别更多概念`, semantic model, embedding search, or automatic Chat fallback.
- One exact match opens detail directly after the click; 2–3 matches show candidates; broader/mixed results fail closed.
- Detail is read-only, current, type-specific, and displayed beside the selection.
- A Markdown document detail prioritizes `用途`, `本次变化`, `影响范围`, `Git 状态`, and `路径`. These fields come from bounded file structure, Git, and literal references, never a model.
- A TypeScript/JavaScript module detail prioritizes `职责`, `公开入口`, `本次变化`, `依赖与影响`, and `路径`. These fields come from bounded source declarations, static imports, Git, and literal test/importer references; source is never executed.
- A test/spec source detail prioritizes detected static test titles and always states that the card did not execute the tests. Never translate source presence into PASS/FAIL.
- A known JSON configuration detail shows purpose and bounded top-level key names only. Never expose configuration values or potential secrets in the card.
- A path-qualified ADR/decision Markdown detail reads only explicit Status, Decision, Context/Rationale, and Consequences sections.
- An explicitly authored `docs/concepts/*.md` artifact may expose meaning, current context, boundary, a bounded process, and a verified workspace evidence line.
- An explicitly authored `docs/changes/*.md` artifact may expose before, after, impact, and a verified workspace evidence line.
- An explicitly authored `docs/decisions/*.md` artifact may expose problem, choice, consequence, and a verified workspace evidence line. Keep ordinary ADR projection separate. Do not infer any of these structures from ordinary prose.
- An explicitly authored `docs/tasks/*.md` record may expose goal, current status, completed work, next step, blocker, update time, and a verified workspace evidence line. Never infer task completion from Chat, TODOs, Git state, or file existence.
- An explicitly authored `docs/verifications/*.md` record may expose claim, explicit result, remaining gap, verification method/revision/time, and a verified workspace evidence line. Keep it separate from static test/spec source, which always remains `未执行` and never implies PASS/FAIL.
- The card is summary-first: facts, revision, observed time, and sources remain inside a collapsed in-card `查看详情` disclosure. Keep type and freshness visible even while collapsed.
- The card header is the only drag handle. A trusted primary-pointer drag may move the card within the visual viewport so obscured Chat remains readable; body selection, disclosures, refresh, and close remain ordinary interactions. A moved card is explicitly pinned for the current reading task: preserve it across same-card refresh, new Chat output, scrolling, and anchor displacement. Clear the pin on explicit close, a new selection, task/route drift, or anchor DOM detachment.
- Keep an un-moved entry or card only while at least one text rectangle of its complete Range anchor intersects the visual viewport. When every anchor rectangle leaves the viewport, close through the ordinary cleanup path; do not clamp an orphaned un-moved card to the viewport edge. A partially visible anchor remains valid, and the preceding explicit pin rule takes priority after a trusted drag.
- Build the bounded annotation catalog in two passes: reserve one highest-priority unambiguous primary term for every represented object first, then spend remaining slots on aliases. Never let several aliases from early objects crowd a later uniquely identifiable object out of quiet marked-object discovery; ambiguous terms still remain unmarked and available only through deterministic selection resolution when disambiguation is possible.
- Use `mental-model` as the ordinary product default. Presentation studies may explicitly fix `record`, `narrative`, or `mental-model` at startup. Never add an in-card condition switch. The mental-model condition keeps evidence behind the local `为什么这样说` disclosure.
- An open card pins its snapshot. A lightweight bounded revision probe may show `内容已更新`; only a trusted `刷新内容` click may re-read full detail, reuse the same card DOM, preserve position/scroll/disclosures, and expose at most three changed fields. Put those explicit-refresh changes before the full P-C model and order them by comprehension need: Task status/next action/blocker; Verification result/unproven boundary/claim; Decision choice/consequence/problem; Concept current context/flow/boundary; Change current state/impact/previous state. Deduplicate equal before/after pairs and mark additions/removals explicitly. Keep ordinary unrefreshed cards free of a persistent change panel. This creates no model call or Chat Turn.
- Keep an open card visible when the user focuses the current Chat composer. Focusing or typing is not an outside-dismiss action; explicit close, Escape, a new selection, task/route drift, or a detached anchor still closes it.
- If the selected file is deleted or revision status is unavailable, keep the old snapshot visible with an explicit warning. Never silently replace, hide, or relabel it as current.

## Task-local dynamic Object lifecycle

The Companion may hold a sparse set of high-value objects that appeared during the current long-running Agent task but are not yet stable enough for a repository artifact. These objects live only in the Companion state directory and are fenced to the current host-vouched task, route, workspace scope, and binding revision.

- Register an object only after the user has enabled this workspace companion and the object has a stable selectable name, is likely to matter after the current turn, and can answer one complete type-specific comprehension unit.
- Use only `concept`, `change`, `decision`, `task`, or `verification`. Do not register ordinary files, every mentioned noun, transient reasoning, raw Chat, TODO fragments, secrets, or model-generated guesses.
- Treat maintenance as Agent-owned only inside that explicit bounded opt-in. Re-evaluate at stable milestones rather than every Chat Turn; normally introduce no more than one new task-local object per milestone unless the user explicitly names multiple objects. This is not invisible semantic mining and does not require a separate user message for every card.
- Before creating a task-local object, search the five frozen artifact directories. A valid stable artifact wins and must not be duplicated in the private registry.
- Run `object-list --json` before mutation. It reports current-task active/terminal counts, hot-registry and audit-archive usage, and `active_soft_limit_reached` at 64 active objects. That warning does not block a justified update, but it is a mandatory curation signal; 256 active objects remains a hard fail-closed limit. Update an existing active `objectKey` when only its summary or mental model changes. Identity fields—key, type, canonical name, and aliases—are immutable; use `object-supersede` when the identity genuinely changes.
- Use `object-retire` when the object is no longer decision-relevant. Superseded and retired keys are terminal and cannot be silently reactivated. They leave the automatic Top-3 annotation catalog, but remain read-only resolvable from historical Chat so old references never become unexplained dead text. Their card must expose lifecycle and, for supersession, the replacement key.
- A fresh bind of the same host task, route, scope, and canonical workspace adopts the existing task objects into the new binding revision without changing their identity or content revision. It must never migrate objects across another task, route, scope, or workspace.
- Every task-local object is displayed with `freshness=partial` and an explicit temporary-context boundary. Agent declaration is not repository authority, test execution evidence, or completion proof.
- Registration refreshes only the identity annotation catalog. It does not open a card, read detail, call a model, or create a Chat Turn.
- Stable milestones that need cross-task reuse must graduate through `$pointable-context-records` with exact workspace evidence. Run the applicable checker first and retire the corresponding task-local object only after the stable artifact reports `valid: true`; if validation fails, preserve the partial object and its explicit boundary. After successful graduation, `object-archive --json` may move the terminal duplicate out of the hot Registry only when the current workspace index contains exactly one stable artifact with the same type and canonical name. It writes the local audit copy before removing the hot record. Active, unmatched, and ambiguous records never archive, and archived records never become lookup authority. Do not treat this private registry or archive as durable project truth.

The strict input document has exactly these top-level fields: `schemaVersion`, `objectKey`, `entityType`, `canonicalName`, `aliases`, `summary`, and `mentalModel`. A Concept example is:

```json
{
  "schemaVersion": 1,
  "objectKey": "DYNAMIC-OBJECT-LIFECYCLE",
  "entityType": "concept",
  "canonicalName": "Dynamic Object Lifecycle",
  "aliases": ["动态 Object 生命周期"],
  "summary": "任务内对象从出现、更新到替代和退役的有界生命周期。",
  "mentalModel": {
    "kind": "concept",
    "meaning": "显式登记当前长任务中尚未固化到仓库的高价值对象。",
    "context": "长任务已经产生只存在于当前任务中的新概念。",
    "boundary": "它不是普通 Chat 文本的模型推断，也不是稳定项目事实。",
    "sequence": ["对象出现", "当前：任务内登记与查询", "稳定后固化或退役"],
    "evidence": "Companion 接收到当前任务上的显式登记动作。"
  }
}
```

`change` uses `before/after/impact/evidence`; `decision` uses `problem/choice/consequence/evidence`; `task` uses `goal/status/completed/next/blocker/evidence`; `verification` uses `claim/result/gap/evidence`.

Write the bounded JSON to a temporary absolute file using the normal file-editing mechanism, call one command, then remove the temporary file. Never place registry payloads in the repository merely to invoke the Companion.

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
   Treat this as the automatic host-contract layer only. For a build qualification, also run the read-only `pointable-context-compatibility` inspector against the exact Codex package version and current renderer bundle. Do not call a build fully qualified while any manual gate is pending.
6. If this bounded long task is explicitly using dynamic objects, run `object-list --json`, inspect its capacity warning, then apply only the sparse lifecycle mutations justified by the current milestone. Run `object-archive --json` only after a stable artifact has passed its checker and the corresponding task-local object is terminal.
7. Ask the user to click a marked registered object or select an exact visible key/name/path, such as `README.md`, and click `查看上下文`.
8. Verify that selection alone produces no detail request; the trusted click produces one direct detail or a bounded candidate menu.
9. For revision qualification, leave one card open, change the selected file, bounded relation, or active task-object mental model, confirm `内容已更新`, then click `刷新内容`. Verify that the same card DOM stays visible at the same position, preserves scroll and disclosure state, displays a finite type-prioritized diff before the P-C model when projected fields changed, keeps an ordinary unrefreshed card quiet, opens no browser, and adds no Chat Turn.
10. Focus the current Chat composer while the card is open. Verify that the composer receives focus, the card stays visible, and its background revision check remains active.
11. Run `unbind --json` only when explicitly requested. Verify that `activeBinding` disappears before binding another root.
12. Run `stop --json` when requested. Stopping removes the renderer/runtime binding but intentionally preserves the explicit task-to-workspace registry and task-object history for later reuse.

```powershell
node $companion status --json
node $companion start --json
node $companion start --presentation-mode mental-model --json
node $companion bind --workspace-root 'D:\absolute\workspace' --json
node $companion object-list --json
node $companion object-upsert --object-file 'C:\absolute\temporary-object.json' --json
node $companion object-supersede --replaces 'OLD-OBJECT-KEY' --object-file 'C:\absolute\replacement.json' --json
node $companion object-retire --object-key 'OBJECT-KEY' --json
node $companion object-archive --json
node $companion unbind --json
node $companion stop --json
```

## Fail closed

- If no target is visible, ask the user to open Codex Desktop with its local CDP endpoint available; do not weaken target/origin checks.
- Treat `compatibility.state=unavailable` as a host that could not be checked and `compatibility.state=incompatible` as a private host-contract mismatch. Do not bind, inject a fallback selector, or describe either state as qualified.
- Treat `qualified_current_runtime` as automatic evidence only. Full build qualification additionally requires the exact host package/executable version, matching renderer SHA-256, and all ten evidence-bound manual interaction gates. Never copy a qualification across builds.
- If binding sees zero or multiple active tasks, ask the user to focus exactly one task and retry.
- If selected text has no exact file identity, leave Chat/copy behavior unchanged; do not send it to a model.
- A mental model without a strict `docs/concepts/*.md`, `docs/changes/*.md`, or `docs/decisions/*.md` identity is still a no-match. A missing required section, concept current step, source line, or exact evidence match must fail closed.
- If task, route, workspace root, binding revision, selection digest, renderer generation, index, or Provider drifts, discard the result and require a fresh explicit action.
- Treat revision v2 as a bounded invalidation fingerprint: selected-file stat plus verified-root Git status/latest selected-file commit/literal relation membership, and explicit mental-model evidence-source stat. It does not prove runtime dependencies or semantic impact, and only a trusted refresh may re-read full detail.
- Present `current` only for a verified live read. Preserve stale/unavailable states exactly as returned.
- Treat Markdown `影响范围` and module `依赖与影响` as bounded literal evidence, not a semantic dependency or runtime impact claim. Preserve explicit Git-unavailable wording when the workspace is not a qualifying Git root.

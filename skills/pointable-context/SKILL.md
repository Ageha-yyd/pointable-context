---
name: pointable-context
description: Enable, inspect, or validate Pointable Context Quiet Context Reveal beside the current Codex conversation, including bounded registered-object annotations and the selection fallback. Use when the user explicitly asks to enable Pointable Context, run its fixture Quiet Mode, inspect its native marked-object or selection interaction, or perform an optional capsule-rendering diagnostic. For authoring stable milestone Concept, Change, Decision, Task, or Verification artifacts, route to pointable-context-records. Do not trigger merely because text was selected or copied, and never treat fixture data as active-workspace evidence.
---

# Pointable Context Quiet Mode

The product-default interaction has two zero-turn entries. After explicit task/workspace binding, the native companion may mark at most three unique, high-value registered objects per visible message with a quiet dotted underline. A trusted click opens bounded, verified context through the existing lookup path. Any registered object not marked remains reachable by selecting its visible reference and clicking `查看上下文`. Neither path opens a browser, calls a model, or creates another Chat Turn.

## Choose the correct mode

1. For the active local workspace, prefer the companion workflow in `$pointable-context-workspace` and require an explicit workspace binding.
2. When the user explicitly asks to preserve stable context, or explicitly opts the current bounded task into milestone context maintenance, use `$pointable-context-records`; do not turn ordinary conversation into artifacts automatically.
3. For a self-contained demonstration, use the bundled fixture companion. Preserve its `FIXTURE-ONLY` status.
4. Use MCP `render_context_capsule` only when the user explicitly asks to diagnose the optional inline renderer. Do not use it as the default product surface.
5. Never route an ordinary request to the browser App Server harness or a Dashboard.

## Fixture Quiet Mode workflow

1. Require an explicit request to enable or validate the Pointable Context fixture.
2. Locate this Skill's absolute catalog path and resolve the plugin root two directories above the skill folder.
3. Use `host/fixture-companion.mjs` from that plugin root. Run `status --json` first; reuse a healthy process and do not start a duplicate.
4. Run `start --json` only after the explicit request.
5. Ask the user to select an exact visible fixture identity, such as:
   - `PRD-inline-pointable-widgets.md`;
   - `ContextScopeRef`;
   - `ARCH-7`;
   - `NATIVE-CAPSULE-P0`;
   - `GOV-1` or `DEV-54A`.
6. The expected UI is a small `查看上下文（fixture）` action. Selection alone must not query data. A trusted click opens detail directly for one exact match or a bounded candidate menu for 2–3 matches.
7. Run `stop --json` only when requested or when cleaning up a failed start.

```powershell
$skillFile = 'ABSOLUTE_PATH_TO_THIS_SKILL.md'
$pluginRoot = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $skillFile) '..\..')).Path
$companion = Join-Path $pluginRoot 'host\fixture-companion.mjs'
node $companion status --json
node $companion start --json
node $companion stop --json
```

## Deterministic routing contract

- The annotation catalog is identity-only and task-fenced. It may contain an opaque object key, term, type, priority, catalog revision, and context fingerprint; it must not contain facts, sources, authority locators, file content, configuration values, or absolute paths.
- Mark only unique registered terms. Per message, mark at most three non-overlapping objects and only their first occurrence. Prefer Task, Decision, Change, Verification, and Concept before Module, Document, Configuration, and File.
- A mark is a discoverability hint, not a detail or freshness claim. Detail is read only after a trusted click.
- Preserve the selection workflow for every registered object omitted by the mark budget or referenced through another deterministic alias.
- Treat text selection inside an open detail card as local reading/copying: keep that card open and never surface a second lookup action or Chat Turn for the card-local selection.
- Match only exact canonical keys, exact stable names/paths, and scope-local deterministic aliases.
- Keep live workspace identities separate from research/test data. The default local index excludes `fixtures`, `study-dist`, and `study-release`; use the fixture companion for fixture identities instead of allowing them to compete with active-workspace objects.
- A workspace Companion may also expose sparse, explicitly registered task-local Concept, Change, Decision, Task, or Verification objects. These are exact-identity records, not semantic extraction; they must remain task/workspace fenced and display `freshness=partial` until graduated to an evidence-backed artifact.
- 0 matches: stay quiet; do not invent an entity.
- 1 match: a trusted action may read and display detail directly.
- 2–3 matches: show compact candidates with name, type, scope, and match reason; wait for the user's choice before reading detail.
- More than 3 or mixed results: ask the user to narrow the selected text.
- Candidate resolution must not prefetch detail.

## No semantic-model recognition branch

- Do not offer LLM semantic expansion, embeddings, or an LLM-generated candidate list.
- Let users select arbitrary visible prose, but resolve it only against registered exact keys, names, paths, and deterministic aliases. Do not send the selected prose to a model through this product.
- Codex Chat handles genuinely open-ended semantic questions. Pointable Context is the faster deterministic point-lookup path for known objects, including those the automatic mark budget omitted.

## Optional MCP rendering diagnostic

When the user explicitly asks to test the optional MCP capsule renderer:

1. Call `resolve_project_entities` with only the stable fixture name or exact key.
2. For one match, call `render_context_capsule` with exactly the returned `entity_ref`.
3. Preserve the `FIXTURE-ONLY` warning and text/structured fallback.
4. State clearly that this validates the optional renderer, not the native marked-object plus selection-fallback interaction.

## Boundaries

- The product target is the current Codex Desktop Chat Lane, not a browser client or Dashboard.
- Agent-known objects populate the data/index layer only after an explicit bounded registration action. A bounded subset may receive quiet identity marks, but registration never automatically creates visible capsules or reads detail.
- Updates keep identity stable; identity changes use explicit supersession; retired/superseded task-local keys remain terminal. Stable cross-task context belongs in the records workflow, not the private task registry.
- Never call a model for deterministic matching or missing facts.
- Do not add an Ask Agent action, send `ui/message`, or treat follow-up messaging as product success.
- Do not reuse expired references or bypass scope, task, route, revision, freshness, or authority checks.
- Do not execute writes or claim a read-only card changes workspace state.
- If the host does not mount UI, report the text fallback rather than simulating success.

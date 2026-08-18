---
name: pointable-context
description: Enable, inspect, or validate selection-triggered Quiet Context Reveal beside the current Codex conversation. Use when the user explicitly asks to enable Pointable Context, run its fixture Quiet Mode, inspect its native selection interaction, or perform an optional capsule-rendering diagnostic. Do not trigger merely because text was selected or copied, and never treat fixture data as active-workspace evidence.
---

# Pointable Context Quiet Mode

The product-default interaction keeps the Chat Lane unchanged until the user selects a stable development reference. Selection performs only local eligibility. A trusted explicit action then opens bounded, verified context beside the selection without a browser, model call, or additional Chat Turn.

## Choose the correct mode

1. For the active local workspace, prefer the companion workflow in `$pointable-context-workspace` and require an explicit workspace binding.
2. For a self-contained demonstration, use the bundled fixture companion. Preserve its `FIXTURE-ONLY` status.
3. Use MCP `render_context_capsule` only when the user explicitly asks to diagnose the optional inline renderer. Do not use it as the default product surface.
4. Never route an ordinary request to the browser App Server harness or a Dashboard.

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

- Match only exact canonical keys, exact stable names/paths, and scope-local deterministic aliases.
- 0 matches: stay quiet; do not invent an entity.
- 1 match: a trusted action may read and display detail directly.
- 2–3 matches: show compact candidates with name, type, scope, and match reason; wait for the user's choice before reading detail.
- More than 3 or mixed results: ask the user to narrow the selected text.
- Candidate resolution must not prefetch detail.

## No semantic recognition branch

- Do not offer `识别更多概念`, semantic expansion, embeddings, or an LLM-generated candidate list.
- Do not send selected prose to a model through this product.
- Codex Chat already handles open-ended semantic questions. Pointable Context is only the faster deterministic point-lookup path.

## Optional MCP rendering diagnostic

When the user explicitly asks to test the optional MCP capsule renderer:

1. Call `resolve_project_entities` with only the stable fixture name or exact key.
2. For one match, call `render_context_capsule` with exactly the returned `entity_ref`.
3. Preserve the `FIXTURE-ONLY` warning and text/structured fallback.
4. State clearly that this validates the optional renderer, not the selection-triggered default interaction.

## Boundaries

- The product target is the current Codex Desktop Chat Lane, not a browser client or Dashboard.
- Agent-known objects populate the data/index layer; they do not automatically create visible capsules.
- Never call a model for deterministic matching or missing facts.
- Do not add an Ask Agent action, send `ui/message`, or treat follow-up messaging as product success.
- Do not reuse expired references or bypass scope, task, route, revision, freshness, or authority checks.
- Do not execute writes or claim a read-only card changes workspace state.
- If the host does not mount UI, report the text fallback rather than simulating success.

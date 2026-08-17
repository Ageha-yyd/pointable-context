---
name: pointable-context
description: Exercise and inspect the bundled Pointable Context mini-project fixture through deterministic read-only entity resolution and detail lookup. Use only when the user explicitly asks to run, validate, or inspect this fixture/demo. Do not use it as evidence about the active Codex project, CWA, or a real production authority, and do not trigger merely because text was selected or copied.
---

# Pointable Context

Use the smallest reliable lookup path while keeping the current runtime boundary explicit: the installed MCP server is a fixture-only probe pinned to its bundled mini-project.

## Workflow

1. Require an explicit request to exercise the Pointable Context fixture. Ordinary selection, highlighting, and copying are inert.
2. Call `resolve_project_entities` with only the selected or supplied text. Do not add a project path, project ID, locator, provider, or guessed entity ID.
3. Treat every result as fixture data. Preserve its `FIXTURE-ONLY` warning in the answer.
4. Route by deduplicated candidate count:
   - 0: report no match and offer Chat clarification.
   - 1: call `read_project_entity` with exactly the returned `entity_ref`.
   - 2–3: show compact candidates with name, type, project, and match reason; ask the user to choose, then pass exactly that candidate's `entity_ref`.
   - More than 3 or mixed results: ask the user to narrow the text or use project search.
5. Never invent, edit, persist, or reuse an expired `entity_ref`. Re-resolve after an invalid, stale, or context-changed reference.
6. Return a read-only fixture snapshot with stable entity identity, useful facts, source, revision, observed time, verification method, and freshness.
7. Keep stale, partial, unavailable, ambiguous, and access-denied states explicit. Never fill missing facts or imply that fixture data came from the user's active project.
8. Preserve the self-contained model-readable text projection. Mark bounded source/fact omissions explicitly; do not imply that the projection contains every field.

## Boundaries

- Do not use this fixture MCP server for a real project lookup.
- Do not call a model for deterministic matching or to manufacture a missing entity.
- Do not search outside the bundled mini-project after it returns no match.
- Do not treat an index timestamp as authoritative detail freshness.
- Do not execute writes, deployment, sending, purchasing, or other side effects.
- Do not claim selection capture, anchored UI, Inline Widget rendering, or same-task referent roundtrip unless the current host has passed those capability gates.
- If either Pointable Context tool is unavailable, state that the fixture runtime is unavailable and use only user-provided facts; do not simulate a successful lookup.

# App Server Referent Prototype

> Historical research route after the v1.1 product reset. This document proves a supported App Server referent mechanism for a client-owned task, but it is not the Pointable Context product-default route because it leaves the user's current Codex Desktop task. It must not be used as evidence for selection-triggered Quiet Context Reveal acceptance.

## Outcome

The App Server-owned same-task research route is qualified for an **App Server-owned Codex task**:

1. A user opens a Pointable Context detail card. This is a read-only local action and starts no model turn.
2. Only after the user explicitly chooses **Reference** does the host append a bounded `POINTABLE_CONTEXT_REFERENT_V1` item with `thread/inject_items`.
3. The injection itself starts no turn. The task remains available for later work.
4. When the user explicitly asks a question, the host uses `turn/start` on the same task. The next model request can read the injected stable entity identity, revision, freshness, verification evidence, facts, and sources.

This closes the protocol-level route required by PRD strategy S10 for a client that owns the App Server task. It does **not** connect the private CDP card in the current Codex Desktop task to that Desktop task's hidden model history.

## Why this route

Codex App Server exposes two different operations with the product semantics needed here:

- `thread/inject_items`: append model-visible Responses API items to a loaded task without starting a user turn.
- `turn/start`: add explicit user input and start model generation.

Keeping them separate preserves the central interaction rule: viewing or referencing structured context does not silently ask the model a question. Generation happens only after an explicit user submission.

Official contract: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## Implemented components

- `src/app-server/referent.ts`
  - Converts a validated detail outcome into `PointableReferentV1`.
  - Enforces a 16 KiB envelope and a maximum of five projected facts and sources.
  - Preserves stable scope, entity ID/type, revision, observed time, freshness, and verification evidence.
  - Marks the payload as untrusted project data rather than instructions.
- `src/app-server/client.ts`
  - Bounded JSONL stdio client for Codex App Server.
  - Handles initialization, request IDs, notifications, deadlines, server requests, stderr bounds, and process cleanup.
- `src/app-server/referent-session.ts`
  - Starts an App Server task, injects one referent, and verifies that no turn was created.
  - Starts a later explicit question on the same task and reads the resulting Agent message.
- `scripts/probe-app-server-referent.mjs`
  - Runs the zero-turn protocol probe.
  - With `--verify-model`, performs one explicit model turn and verifies an unpredictable token carried only by the referent.
  - Deletes the exact probe task after completion.

## Runtime evidence — 2026-08-18

### Zero-turn injection

The live probe completed:

```text
thread/start -> thread/inject_items -> thread/read
turns before injection: 0
turns after injection: 0
injection created a turn: false
probe task deleted: true
```

### Model-visible same-task context

The model verification probe injected a synthetic entity, revision, and random token, then started one explicit question in the same task. The Agent returned the exact expected triple:

```text
POINTABLE:REFERENT-4d4d650fb4ac91bf|rev-4d4d650fb4ac91bf|4d4d650fb4ac91bf
```

The expected and actual values matched, and the probe task was deleted afterward. This proves model visibility for the tested App Server route; it is not a claim about an arbitrary Desktop task or every future Codex version.

## Required product behavior

- **View detail:** no injection, no model call, no new turn.
- **Reference:** explicit action; inject one bounded referent and show a visible host-owned “referenced” state.
- **Ask:** explicit user submission; call `turn/start` in the same App Server task.
- **Stale data:** keep `freshness`, `observedAt`, and revision visible; never silently upgrade stale data to current.
- **Edit or replace:** App Server does not document item-level mutation/deletion for an injected item. A client must inject a visibly superseding referent or create/fork a task; it must not pretend to have rewritten history.
- **Failure:** keep the detail card usable and allow ordinary Chat fallback. Never claim a reference was attached unless injection succeeded.

## Remaining integration boundary

The current live selection UI is a private Codex Desktop CDP/DOM companion. The referent prototype is a separate App Server client path. Those two host task graphs are not currently joined.

The recommended next implementation is therefore a minimal App Server-owned conversation client that renders Chat and Pointable Context affordances in one surface. In that client, the task ID, referent injection, subsequent question, and visible reference chip can share one supported host lifecycle. DOM automation of the existing Desktop composer is not the recommended bridge.

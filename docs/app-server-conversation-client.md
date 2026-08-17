# App Server Conversation Client

## Purpose

This prototype puts Chat, Selection Quick Look, a visible referent chip, and the later question in one App Server-owned Codex task. It is the first implementation of PRD stage 2 after the headless referent protocol qualification.

It deliberately does not automate the existing Codex Desktop composer. The local web client owns the App Server task and therefore has a supported identity for both `thread/inject_items` and `turn/start`.

Official contract: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## Interaction

```text
send message -> turn/start -> streamed Agent message
select visible message text -> local eligibility only
click View Context -> bounded local workspace lookup -> anchored detail
click Reference -> thread/inject_items -> visible referent chip -> zero new turns
send later question -> turn/start in the same task -> model can use the referent
```

The selection gesture itself performs no workspace read and no model call. The lookup occurs only after the explicit View Context action. The model runs only after the composer is submitted.

## Components

- `src/app-server/conversation-service.ts`
  - Starts and owns one App Server task.
  - Binds one canonical local workspace to that task without impersonating a Desktop task.
  - Reuses the bounded file identity index, exact resolver, authoritative live file reader, referent envelope, and App Server client.
  - Issues short-lived, one-shot candidate and detail capabilities.
  - Streams `item/agentMessage/delta` and closes the turn on `turn/completed`.
- `src/app-server/conversation-http.ts`
  - Binds only to `127.0.0.1`.
  - Uses a random fragment-carried capability token for every API request.
  - Enforces request, header, body, and asset bounds plus a restrictive CSP.
  - Exposes state, lookup, reference, and SSE turn endpoints.
- `src/app-server/conversation-cli.ts`
  - Starts the App Server child, the task, and the loopback client.
  - Accepts an explicit workspace root and optional delete-on-exit behavior.
- `web/conversation-client.*`
  - Renders the Chat lane, local selection affordance, candidate menu, detail card, visible referent tray, and streaming composer.
  - Projects all context data with DOM `textContent`; no HTML injection path is used.
  - Requires trusted pointer clicks for lookup, candidate selection, reference, and close actions.

## Run

```powershell
pnpm install
pnpm run build
pnpm run client:app-server
```

When installed as the Pointable Context Plugin, the explicit-only `pointable-context-conversation` Skill locates the same bundled client, starts it for a user-approved workspace root, and returns its loopback URL. It does not attach to or inject into the current Codex Desktop task.

The command prints a loopback URL containing a random fragment token. Open that exact URL. The fragment is not sent in ordinary HTTP requests; the client passes it in a dedicated request header.

To delete the created task when the client exits:

```powershell
node dist/src/app-server/conversation-cli.js --workspace-root . --delete-thread-on-exit
```

## Qualification evidence — 2026-08-18

- Automated suite: `178 / 178 PASS`.
- Real App Server probe:
  - exact `README.md` lookup returned `file:README.md` and a live content revision;
  - reference injection left task turns at zero;
  - the later explicit question streamed non-empty Agent delta events;
  - final Agent text exactly matched the referenced entity ID and revision;
  - the probe task was deleted.
- Headless Edge acceptance:
  - two visible Chat messages;
  - message-only selection affordance;
  - live `README.md` detail card;
  - one visible referent chip;
  - working close interaction;
  - no additional model turn during lookup or reference.

## Current boundary

This is a local research and qualification client, not a production Chat replacement. It does not yet provide:

- task resume after process restart;
- a UI for tool approvals or user-input server requests;
- remote/team providers, authentication, authorization, or multi-user isolation;
- Markdown rendering, file mutation, Dashboard, or write actions;
- a portable Selection API for arbitrary third-party Agent hosts;
- an Inline MCP App qualification in the current Windows host.

The next recommended stage is to reuse the same object and referent contracts in an Inline MCP App probe, then build the A/B/C point-lookup study only after the host gates are recorded separately.

---
name: pointable-context-conversation
description: Start, inspect, or stop the opt-in Pointable Context App Server conversation client for an explicit local workspace. Use only when the user asks to open or manage the same-surface research client that combines Chat, selected-text Quick Look, visible object references, and later Agent questions. Do not trigger for ordinary chat, text selection, fixture MCP lookup, or the separate Codex Desktop companion.
---

# Pointable Context Conversation

Run the local research client on a new Codex App Server-owned task. Keep it separate from the current Codex Desktop task and the CDP workspace companion.

## Boundaries

- Require an explicit existing workspace root. Never infer another repository, Dashboard, DCPM, or CWA scope.
- Treat lookup as read-only. Selection and candidate discovery must not start a model turn.
- Explain that referencing an object injects bounded model-visible context into the new client task without creating a turn; the next submitted message starts the turn.
- Do not claim resume, approval UI, multi-user isolation, write actions, or current-Desktop-task injection.
- Use the URL token only in the local fragment. Never log or publish it.

## Start

1. Resolve this Skill's absolute catalog path. Resolve the plugin root two directories above the Skill folder.
2. Require these files below the plugin root:
   - `dist/src/app-server/conversation-cli.js`
   - `web/conversation-client.html`
3. Canonicalize the user-approved workspace root and verify that it is a directory.
4. Start one long-running process from the plugin root and retain its session:

```powershell
node .\dist\src\app-server\conversation-cli.js --workspace-root 'D:\absolute\workspace' --delete-thread-on-exit
```

5. Wait for the process to print `Pointable Context conversation client` and its loopback URL. Return that exact URL to the user as a clickable link.
6. Explain the interaction succinctly: send a message, select an exact visible filename/path in a user or Agent message, click `查看上下文`, inspect or choose the object, click `引用到当前任务`, then ask the next question.

## Inspect and stop

- Inspect the retained process session for current output. Do not start a duplicate when a healthy client for the same workspace is already running.
- Stop only when the user asks, the process fails, or the task ends and cleanup is required. Closing the process with `--delete-thread-on-exit` deletes its App Server task.
- If startup fails before a URL is printed, report the fixed public error, clean up the process, and do not expose raw selected text or workspace content.

## Fail closed

- Refuse non-loopback serving or a missing/invalid workspace root.
- If Codex App Server cannot start, preserve the current Desktop task and report the unavailable boundary.
- If lookup returns no match or overflow, leave ordinary Chat available; do not silently send arbitrary prose to the model for semantic resolution.
- If a streamed request is abandoned, let the client interrupt the active turn before starting another.

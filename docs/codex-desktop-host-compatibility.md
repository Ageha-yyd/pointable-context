# Codex Desktop Host Compatibility

Observed and qualified on 2026-08-17. This matrix freezes the private Selection Host support surface; it does not turn CDP or Codex DOM selectors into a public OpenAI contract.

## Qualified snapshot

| Boundary | Qualified value | Evidence |
|---|---|---|
| OS / architecture | Windows, x64 | Live package inspection |
| Codex Desktop package | `OpenAI.Codex 26.810.7004.0` | `Get-AppxPackage` read-back |
| Desktop executable | `ChatGPT.exe 151.0.7922.137` | File-version read-back; informational, not the package version |
| Codex CLI used for Plugin probe | `codex-cli 0.146.0` | CLI read-back; not evidence for the Desktop renderer |
| Node runtime used for local verification | `v25.9.0` | Runtime read-back |
| CDP discovery origin | `http://127.0.0.1:9223` | Loopback-only, explicit numeric port |
| Accepted page target | Exact `app://-/index.html` | Same-target loopback WebSocket ID gate |
| Rejected adjacent target | `app://-/index.html?initialRoute=...` | Exact URL gate; avatar overlay is not attached |
| Main execution context | Default context of the main `app://-/index.html` frame | Runtime context/frame binding and lifecycle reset tests |
| Stable root | `main[data-app-shell-main-surface]` | Fail closed if absent |
| Active task tuple | Exactly one `[data-app-action-sidebar-thread-active="true"]` with thread and host IDs | Host read before lookup and during revalidation |
| Eligible message root | `[data-selected-text-overlay-target]` inside a user or assistant message | Single connected Range; 1–512 characters |
| Explicit activation | Trusted pointer/keyboard action only | Selection stays local; synthetic click rejected |
| Detail presentation | Text-only anchored card owned by one renderer lifecycle | Bounded fields, no script/HTML authority |
| Live authority | Explicit task→canonical workspace binding + click-time local file read | `live_read`, verified revision, current only after revalidation |

## Qualification evidence

- `pnpm run check`: pass.
- `pnpm test`: `164 / 164 PASS`.
- `pnpm run test:host-browser`: trusted drag → detail → close; native selection cleared and no remount after 250 ms.
- User manual gate: three visible workspace keywords produced live details; the repaired close action worked.
- Live management gate: persisted binding read-back, explicit `unbind`, empty binding status, explicit `bind`, and `replaced: true` rebind all passed.
- Plugin cache: `pointable-context@personal 0.1.0+codex.20260817152630`, with the workspace Skill and identical companion bundle in source, marketplace source, and installed cache.

## Unsupported or unqualified

- Any Codex Desktop package other than the qualified snapshot above.
- macOS, Linux, web ChatGPT, mobile selection, IDE surfaces, avatar overlay, embedded browser, terminal, diff, composer, iframe, or subagent activity surfaces.
- Automatic background start, automatic task/workspace inference, semantic recognition of arbitrary prose, workspace mutation, remote providers, telemetry, or administrator deployment.
- Treating the private renderer as MCP Apps UI, an Agent message payload, or a portable Codex extension contract.
- Referent return to the model or “ask Agent” from the card. Detail viewing currently creates no new turn.

## Version and failure policy

1. Treat any Desktop package change, target URL change, selector change, execution-context change, or failed manual gate as unqualified.
2. Fail closed: do not attach, query, or deliver stale detail when a gate fails.
3. Preserve normal Chat, copy, and the fixture/headless Plugin paths as fallbacks.
4. Re-run type checks, the full suite, the headless browser close test, live `status`, and one manual select/click/close gate before adding a new version row.
5. Do not silently widen selectors to recover compatibility. Add evidence and a new matrix row.

OpenAI's supported client-integration surface is the [Codex App Server](https://learn.chatgpt.com/docs/app-server), which exposes task/thread identifiers and structured events for rich clients. The current App Server documentation does not define Chat Lane DOM selection or anchored overlay rendering, so this prototype keeps those capabilities behind the explicitly qualified private adapter.

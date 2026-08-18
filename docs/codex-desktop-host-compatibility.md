# Codex Desktop Host Compatibility

Observed and qualified on 2026-08-17. This matrix freezes the private Selection Host support surface; it does not turn CDP or Codex DOM selectors into a public OpenAI contract.

Inline MCP App work is tracked as a separate host gate. It must not be inferred from the private Selection overlay, and the Selection overlay must not be described as an MCP App.

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
- `pnpm test`: `194 / 194 PASS` after the v1.5 compatibility increment, including packaged-layout start, deterministic Markdown/source parsing, Git enrichment, non-Git fallback, bounded declaration projection, product-direction freeze, renderer contracts, and compatibility-state classification.
- `pnpm run test:host-browser`: three consecutive real Edge headless passes; trusted drag → compact detail; detail body initially has zero layout height; trusted in-card disclosure expands in place; close clears native selection and prevents remount after 250 ms. The script waits for card reposition paint boundaries so the trusted pointer coordinates cannot race layout.
- Real repository Artifact probe: `docs/PRD-inline-pointable-widgets.md` returned purpose, current changed sections, three bounded literal references, Git status, and relative path in 128 ms total on the qualified machine (16 ms index + 112 ms detail). This is one local probe, not a population latency claim.
- Real repository Source Module probe: `src/adapters/local-workspace.ts` returned responsibility, public exports, changed declarations, prioritized local dependencies, test/importer references, and relative path in 140 ms total on the qualified machine (14 ms index + 126 ms detail). This is one local probe, not a population latency claim.
- User manual gate: three visible workspace keywords produced live details; the repaired close action worked.
- User manual Artifact Context gate (2026-08-18): after binding the active Codex task to this repository, selecting `PRD-inline-pointable-widgets.md` in the native Chat Lane exposed the v1.2 purpose, current change, impact, Git status, and path fields in place, without opening a browser or adding a Chat Turn.
- User manual summary-first gate (2026-08-18): the v1.4 native Chat Lane card was accepted with its compact summary-first presentation and card-internal detail disclosure; the heavier facts remain hidden until the user explicitly expands them.
- Live management gate: persisted binding read-back, explicit `unbind`, empty binding status, explicit `bind`, and `replaced: true` rebind all passed.
- Plugin cache: the current `pointable-context@personal` cachebuster version is read back after each local reinstall, with all three Skills and the rebuilt companion bundle required in the installed cache.

## Startup compatibility status (v1.5)

`workspace-companion status --json` exposes a bounded `compatibility` object for the private Chat Lane host contract:

| State | Meaning | Required behavior |
|---|---|---|
| `qualified` | Exact main target, main frame, default main execution context, and renderer lifecycle passed | Attachment may be reported for this runtime; manual interaction gate is still separate |
| `unavailable` | Debug endpoint or transport could not be checked | Leave Chat Lane unchanged; retry only after the host becomes available |
| `incompatible` | Host was reachable but a required private contract did not match | Fail closed; no fallback selectors, binding, action, or card |
| `unchecked` | No refresh completed | Do not claim attachment or compatibility |

Automated negative probes cover an empty qualified-target set, an invalid renderer-install response, and an unavailable discovery endpoint. The renderer mismatch probe verifies `targetCount=0` and a closed connection after cleanup. These startup gates prove only that the private renderer can be installed; they do not prove trusted selection, disclosure, close, focus, navigation, or virtualization behavior on a new Desktop build.

## Unsupported or unqualified

- Any Codex Desktop package other than the qualified snapshot above.
- macOS, Linux, web ChatGPT, mobile selection, IDE surfaces, avatar overlay, embedded browser, terminal, diff, composer, iframe, or subagent activity surfaces.
- Automatic background start, automatic task/workspace inference, semantic recognition of arbitrary prose, workspace mutation, remote providers, telemetry, or administrator deployment.
- Treating the private renderer as MCP Apps UI, an Agent message payload, or a portable Codex extension contract.
- Referent return to the model or “ask Agent” from the card. Detail viewing currently creates no new turn.

## Optional inline Context Capsule renderer gate (2026-08-18)

| Gate | Result | Meaning |
|---|---|---|
| Official architecture | `SUPPORTED PATTERN` | OpenAI's Plugin UI guide defines a tool-linked UI resource, `text/html;profile=mcp-app`, iframe rendering, initialization, and tool-result delivery. It does not promise that arbitrary prose spans can be rewritten as links. |
| Installed package implementation | `PRESENT / PRIVATE BUILD EVIDENCE` | Read-only inspection of `OpenAI.Codex 26.810.7004.0` found MCP App resource parsing, sandbox iframe setup, initialization, and tool-result delivery. This optional renderer does not depend on follow-up messaging or model-context mutation. |
| Top-level Chat Lane bridge | `ABSENT` | CDP probe found no top-level `window.openai`, `sendFollowUpMessage`, `updateModelContext`, or `callTool`; the generic private Electron bridge is not an authorized product integration surface |
| Plugin discovery | `PASS_INSTALLED` | Fresh Codex CLI 0.146 App Server attributed `render_context_capsule` to `pointable-context@personal` and exposed `ui://pointable-context/context-capsule-v2.html`. The exact cachebuster is read back during installation. This remains an explicit diagnostic rather than the default product trigger. |
| MCP/resource contract | `PASS_AUTOMATED` | Data/render separation, standard MIME, restrictive resource CSP, text fallback, structured detail, fixture development types, and stdio bundle pass. |
| iframe interaction | `PASS_ISOLATED_EDGE_ZERO_TURN` | A real iframe completed initialization, received a document result, exposed type-specific facts, and expanded/collapsed locally. No `ui/message`, model-context update, or browser navigation was emitted. |
| Current Desktop inline mount | `PENDING_LIVE` | Requires a post-install fresh Codex task to visibly mount `context-capsule-v2` beside the render tool result. |
| Current Desktop zero-turn behavior | `PENDING_LIVE` | Requires observing that expand/collapse leaves the task turn count unchanged and does not navigate away. |

These last two rows qualify only the optional renderer. They do not replace the v1.1 Selection Host gate, and a standalone browser page or direct App Server tool call cannot close either native-host claim.

## Version and failure policy

1. Treat any Desktop package change, target URL change, selector change, execution-context change, or failed manual gate as unqualified.
2. Fail closed: do not attach, query, or deliver stale detail when a gate fails.
3. Preserve normal Chat, copy, and the fixture/headless Plugin paths as fallbacks.
4. Re-run type checks, the full suite, the headless browser close test, live `status`, and one manual select/click/close gate before adding a new version row.
5. Do not silently widen selectors to recover compatibility. Add evidence and a new matrix row.

OpenAI's supported client-integration surface is the [Codex App Server](https://learn.chatgpt.com/docs/app-server), which exposes task/thread identifiers and structured events for rich clients. The current App Server documentation does not define Chat Lane DOM selection or anchored overlay rendering, so this prototype keeps those capabilities behind the explicitly qualified private adapter.

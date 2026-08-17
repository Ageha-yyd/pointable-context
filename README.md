# Pointable Context

The current product requirements and qualification boundary are maintained in [docs/PRD-inline-pointable-widgets.md](docs/PRD-inline-pointable-widgets.md).

This directory implements the PRD's first independent delivery slice: the **P0-A Selection Core**, a bundled headless MCP fixture probe, an opt-in fixture companion, an experimental live local-workspace companion, and a minimal App Server-owned conversation client. It is not the complete P0-A slice and the Codex CDP surface is not a portable public host contract.

The shipped MCP path remains intentionally UI-free and pinned to `fixtures/mini-project`; every MCP tool result is marked `FIXTURE-ONLY`. Two separate, opt-in CDP companions are available: the deterministic fixture companion and a live local-workspace companion. The latter requires an explicit user bind of one host-visible Codex task to one canonical workspace root, then indexes only bounded file identities and reads file detail live on click. Neither companion is started automatically by the Plugin.

## Included

- Pure pre-click selection eligibility with no context-data dependency.
- File-backed development/fixture binding and fail-closed context revalidation.
- Exact canonical key, name, scope-local alias, and normalized matching.
- `0 / 1 / 2–3 / >3` routing without prefetching candidate details.
- Authoritative JSON provider with identity and freshness validation.
- Bounded human-readable projection plus complete structured JSON detail.
- Verification method/time and explicit source/fact projection counts.
- Aggregate index/work budgets and abortable, deadline-bounded port calls.
- Fixture project and unit/CLI/MCP stdio tests.
- Two headless read tools: `resolve_project_entities` and `read_project_entity`.
- Opaque, time-limited `entity_ref` capabilities bound to the full trusted-binding tuple and index revision.
- A self-contained `mcp/server.mjs` bundle, Plugin manifest, `.mcp.json`, and fixture-specific Skill.
- A controlled Codex CDP Host Adapter with local selection eligibility, trusted-click gating, contextual fences, bounded display, lifecycle cleanup, and a fixture-only private probe entrypoint.
- A fixture-only companion with `start`, `status`, and `stop`, periodic target discovery, reconnect support, graceful renderer cleanup, and a self-contained `host/fixture-companion.mjs` bundle.
- A host-vouched Codex task tuple (`threadId`, `hostId`, route, fingerprint) re-read before lookup and during core revalidation.
- A user-local task→workspace registry with opaque workspace scope IDs, canonical-root pinning, revision invalidation, and fail-closed task/route/root drift handling.
- A bounded local-workspace file index plus `live_read` Provider that returns current path, metadata, content revision, preview, and source without requiring a Dashboard.
- A persistent live local-workspace companion with `start`, `status`, `bind`/rebind, `unbind`, and `stop`, plus a self-contained `host/workspace-companion.mjs` bundle and an explicit-only management Skill.
- A bounded `PointableReferentV1` envelope plus a reusable Codex App Server client/session that can inject an explicit reference without creating a turn, then ask about it in the same App Server-owned task.
- A loopback App Server conversation client that keeps Chat, message selection, local-workspace detail, visible referent chips, SSE Agent output, and later questions on one supported task surface.
- An explicit-only `pointable-context-conversation` Skill that starts and manages that local App Server-owned client without impersonating the current Desktop task.

## Not yet claimed

- A portable or production-qualified Codex Chat Lane selection integration. The local private fixture probe is a narrow runtime qualification, not a general host contract.
- Inline MCP App rendering.
- Same-task referent roundtrip from the existing private Desktop CDP card into that current Desktop task. The separate App Server-owned task route is qualified.
- Dashboard or write actions.
- A portable/public production host contract. Current task evidence is qualified only for this Codex Desktop CDP/DOM adapter.
- Remote, team, SaaS, database, or project-management Providers. The first live Provider is local read-only workspace files; DCPM/CWA remains one optional reference Provider.
- A production Codex Desktop integration or model-mediated lookup against live context. A fresh Desktop task qualifies only the fixture MCP fallback.
- Production conversation-client concerns such as task resume, approval UI, remote authentication, multi-user isolation, write actions, or a public hosted surface.

`FixtureFileProjectBinding` and `JsonAuthoritativeProvider` are fixture/development adapters. A file manifest is not proof of the active production host context, and `fixture_read` cannot claim live-current freshness. The bundled MCP server exposes only the mini-project and must not be presented as the production trust boundary.

`LookupService.issueActivation()` is a host-private boundary, not a public MCP/data tool. A production adapter may call it only after a verified explicit user action and must keep the issued ticket bound to that host event.

The shipped `.mcp.json` uses the camelCase `{ "mcpServers": ... }` wrapper accepted by the local Plugin validator and the matching Codex 0.146 runtime parser. It sets `cwd: "."`, so Codex anchors relative paths to the installed plugin root. It does not depend on `${PLUGIN_ROOT}` expansion. Package-level MCP v2 stdio and the self-contained bundle are covered by tests; host-level Codex CLI and Desktop qualification are reported separately.

Runtime qualification on 2026-08-17: an installed `pointable-context@personal` cache was loaded by a fresh Codex CLI 0.146 app-server. Without starting a model turn, the probe verified Plugin attribution, both advertised tools, `GOV-1` resolution, opaque `entity_ref` handoff, fixture detail read, model-readable text, `fixture_read` verification, and absence of UI metadata. A fresh Codex Desktop task then used the same two tools to resolve and read `GOV-1`. These results qualify only the fixture path; trusted live context-scope binding and production Providers remain unverified.

## Verification snapshot

| Check | Result | Boundary |
|---|---|---|
| Automated tests | `178 / 178 PASS` | Core, fixture adapters, live workspace binding/index/provider, CLI, MCP stdio/bundle, both companions, App Server referent/session/conversation client, explicit unbind/rebind, and regressions |
| Independent security audit | `PASS (private fixture boundary)` | No known P0/P1 in the controlled loopback CDP Host Adapter; not a production authority approval |
| Codex CLI 0.146 app-server direct resolve→read | `PASS` | Installed headless Plugin; direct RPC; bundled mini-project only |
| Codex Desktop fixture invocation | `PASS_FIXTURE` | Fresh task used the installed headless fixture tools; no real context authority claim |
| Selection / anchored UI | `PASS_PRIVATE_FIXTURE_PERSISTENT` | Current Desktop only; trusted CDP mouse drag → inert selection → explicit trusted click → bounded fixture card → no new turn; companion remains attached until stopped |
| Close interaction | `PASS_EDGE_HEADLESS` | Trusted drag → detail → close; native selection cleared and no action/card remounted after 250 ms |
| Trusted local workspace scope | `PASS_PRIVATE_IMPLEMENTATION` | Explicit task bind, registry/root/revision drift gates, callback-time host task revalidation, and unit/E2E tests pass |
| Live local workspace Provider | `PASS_PRIVATE_IMPLEMENTATION` | Bounded filenames/paths, exact resolver, fresh file read, revision change, traversal rejection, and source projection pass |
| Current Chat Lane live-workspace card | `PASS_USER_MANUAL` | User manually verified three visible workspace keywords, live detail display, and the repaired close interaction in the current Codex task |
| App Server referent injection | `PASS_ZERO_TURN` | `thread/inject_items` preserved zero turns in an App Server-owned task; the exact probe task was deleted afterward |
| App Server model-visible referent | `PASS_SAME_TASK_MODEL_VISIBLE` | A later explicit turn in the same task returned the exact injected entity, revision, and unpredictable token |
| App Server same-surface client | `PASS_LOCAL_RESEARCH_CLIENT` | Real lookup→reference kept zero turns; a later question streamed Agent deltas and exactly returned entity+revision; headless Edge passed detail, chip, and close |

## Development

```powershell
pnpm install
pnpm test
pnpm run build

"GOV-1" | node dist/src/cli.js eligible --stdin --surface assistant_message
"请查看 GOV-1" | node dist/src/cli.js lookup --stdin --project-dir ./fixtures/mini-project
"harness" | node dist/src/cli.js lookup --stdin --project-dir ./fixtures/mini-project --json
node mcp/server.mjs --fixture-root ./fixtures/mini-project --project-id PRJ-01

# Persistent, fixture-only Desktop companion. It remains active until stopped.
node host/fixture-companion.mjs start
node host/fixture-companion.mjs status
node host/fixture-companion.mjs stop

# With the companion running, select GOV-1, ARCH-7, or harness inside a
# user/assistant Chat Lane message, then click “查看上下文（fixture）”.

# Mouse-level live acceptance without stopping the companion.
node scripts/fixture-companion-live-acceptance.mjs GOV-1

# Browser-isolated regression for action positioning and terminal close.
pnpm run test:host-browser

# Private, local-only Desktop qualification. It injects a fixture-only card,
# exercises it with a trusted CDP mouse click, then removes all injected state.
node scripts/private-fixture-desktop-probe.mjs

# Experimental live local-workspace companion. Do not run it together with
# the fixture companion: each owns one renderer binding on the same Chat Lane.
node host/workspace-companion.mjs start
node host/workspace-companion.mjs status
node host/workspace-companion.mjs bind --workspace-root "D:\github repository\CHI"
node host/workspace-companion.mjs unbind

# Then select an exact visible file identity such as README.md, package.json,
# or PRD-inline-pointable-widgets.md and click “查看工作区上下文”.
node host/workspace-companion.mjs stop

# Supported same-task referent protocol probe. The default path starts no model
# turn; --verify-model adds one explicit test question and deletes the probe task.
pnpm run probe:app-server-referent
node scripts/probe-app-server-referent.mjs --verify-model

# Minimal same-task client: Chat + Selection Quick Look + referent chip.
pnpm run build
pnpm run client:app-server

# Real protocol and browser-level acceptance.
pnpm run probe:app-server-conversation
pnpm run test:conversation-browser
```

`status` exposes the currently host-visible task binding without exposing the control token. Repeating explicit `bind` is a rebind with a new revision; `unbind` removes only the current host-visible task entry. `eligible` is local and reads no project data. Running `lookup` is the explicit activation. Standard input (`--stdin`) is the recommended input path so selection text does not appear in the process list. `--text` is available only with the explicit `--allow-argv-text` acknowledgement.

Lookup exit codes are stable for shell integration: `0` detail, `2` blocked/invalid input, `3` authority or activation unavailable, `4` candidate choice required, `5` no match, and `6` overflow/refinement required.

The companions and private Desktop probe are deliberately separate from the Plugin's default MCP path. They require a locally trusted Codex Desktop loopback CDP endpoint. The fixture companion never reads a real workspace. The live companion reads only the explicitly bound local workspace and ignores common build/cache trees; a file-count or depth overflow fails closed instead of silently truncating. `DCPM/CWA` is not imported or started by either path. Control state is user-local under `%LOCALAPPDATA%\PointableContext`; each control server binds only to `127.0.0.1` and requires a random per-process token. `stop` removes the renderer, binding, state file, and runtime lock before returning; the explicit task-workspace registry is intentionally retained until it is replaced by another explicit bind.

The private Desktop support boundary is frozen in [docs/codex-desktop-host-compatibility.md](docs/codex-desktop-host-compatibility.md). A package or DOM change is unqualified until the matrix gates are rerun; selectors must not be silently widened.

The supported referent route, runtime evidence, and remaining Desktop boundary are documented in [docs/app-server-referent-prototype.md](docs/app-server-referent-prototype.md).

The minimal same-surface client, run instructions, security boundary, and qualification evidence are documented in [docs/app-server-conversation-client.md](docs/app-server-conversation-client.md).

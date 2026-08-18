# Pointable Context

Pointable Context explores one narrow product claim: in long-running software-development tasks, people should be able to select a compressed project reference in the current Codex conversation and reveal verified context in place, without opening a browser, reading an entire file, or creating another Chat Turn.

The normative product definition is [docs/PRD-inline-pointable-widgets.md](docs/PRD-inline-pointable-widgets.md).

## Product direction

The primary interaction is **Quiet Context Reveal**:

1. The Agent's work populates a lightweight Context Index with stable document, module, decision, and task identities.
2. The ordinary Chat Lane stays visually unchanged until the user selects a relevant reference.
3. A small `查看上下文` action appears for a bounded, eligible message selection; this local step does not inspect workspace data.
4. A trusted click deterministically resolves exact keys, file names/paths, stable names, or scope-local aliases, then opens current detail beside the selection.
5. No browser opens, no model call is made, and no follow-up turn is created.

There is deliberately no "identify more concepts" or semantic-model branch. General semantic questions already belong in Codex Chat; adding another model pass inside the selection path would increase latency and ambiguity. The browser App Server client, DCPM/CWA integration ideas, and a full Dashboard are research references, not the default product route.

## Live Markdown artifact context

For an explicitly bound local Git workspace, Markdown documents now expose a deterministic five-fact view after the trusted click:

- purpose from the first H1 and first useful prose paragraph;
- current change from dirty diff sections, or the latest commit when clean;
- impact from at most three tracked files that literally reference the selected file name;
- Git state;
- workspace-relative path.

The extractor runs on demand, uses bounded local file/Git reads, and makes no model call. If Git is unavailable, the file remains readable and the Git state is shown as unavailable. Literal references are evidence of mention, not a semantic dependency graph.

## Live source-module context

TypeScript and JavaScript family files expose a separate deterministic five-fact view:

- responsibility from a bounded leading source comment, with a conservative export-based fallback;
- public exports;
- current Git state plus at most three changed declarations;
- at most two prioritized direct static dependencies combined with at most three bounded test/importer references, projected into one compact field;
- workspace-relative path.

Supported extensions are `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`. The extractor never executes source, starts a language server, or calls a model. Importers and tests are literal reference evidence, not a complete runtime call graph.

## Dynamic detail refresh

An open workspace detail card now pins the snapshot the user is reading. A bounded background probe checks only the selected file's local stat revision; it does not repeatedly read or re-project full detail. When that revision changes, the same card shows a quiet `内容已更新` notice. Only a trusted `刷新内容` click performs a new authoritative detail read, updates the card in place, and shows at most three changed fields. This path opens no browser, calls no model, and creates no Chat Turn.

If the file is deleted or the probe becomes unavailable, the prior snapshot stays visible with an explicit warning. Task rebinding, expired references, context drift, or capacity exhaustion disable refresh rather than widening authority. The first probe intentionally detects source-file stat changes only; relation-only or Git-only changes may require reopening the detail until a broader lightweight revision contract is qualified.

## Scenario-specific safe projections

The workspace Provider now classifies three additional high-value development artifacts without adding model inference:

- test/spec source files show detected static `test`/`it` titles, current source change evidence, bounded dependencies, and an explicit `not executed` warning. Reading the file never claims PASS or FAIL;
- known JSON configuration files such as `package.json`, `tsconfig*.json`, `.mcp.json`, and Plugin manifests show their purpose and bounded top-level key names. Configuration values and potential secrets never enter the card;
- ADR/decision Markdown paths show only explicit Status, Decision, Context/Rationale, and Consequences sections.

These are conservative projections of readable artifacts, not substitutes for an actual test-run result, runtime configuration resolution, or a semantic decision graph.

## Explicit concept artifacts and presentation pilot

An author can now give a high-value project concept a deterministic identity by placing a strictly structured Markdown artifact under `docs/concepts/*.md`. The format requires meaning, current context, boundary, a 2–4 step process with one explicit current step, an evidence excerpt, and a workspace-relative source line. The Provider verifies that evidence line before returning the card; missing or drifted evidence fails closed. Ordinary prose is still not semantically mined.

The native renderer supports three fixed research conditions over the same detail payload: `record`, `narrative`, and `mental-model`. The first frozen object is `pilot`. Its mental-model card shows what the pilot means, why it is needed now, where it sits in the study sequence, and what it cannot prove; exact evidence stays behind an in-card `为什么这样说` disclosure. The condition is selected when the companion starts, not by the participant inside a task.

## Current fixture

The installed MCP server is deliberately pinned to `fixtures/mini-project`. Every result is marked `FIXTURE-ONLY`; it is not evidence about the active workspace.

Development-oriented examples include:

| Key | Capsule type | Demonstrates |
|---|---|---|
| `PRD-inline-pointable-widgets.md` | File / document | purpose, recent change, impact, revision |
| `ContextScopeRef` | Module / concept | definition, responsibility, dependencies, maturity |
| `ARCH-7` | Decision | decision, rationale, alternatives, consequence |
| `NATIVE-CAPSULE-P0` | Task state | goal, completed work, next step, blocker |
| `GOV-1`, `DEV-54A` | Legacy work unit | compatibility with the earlier lookup fixture |

The fixture MCP server exposes:

- `resolve_project_entities`: deterministic identity resolution; detail is not prefetched;
- `read_project_entity`: bounded text/structured detail fallback;
- `render_context_capsule`: optional type-specific rendering probe linked to a self-contained MCP App resource; it is not the default product trigger.

The default Desktop companion keeps the lane clean until selection. A trusted click reveals 3–7 prioritized facts, revision, observed time, freshness, relations, sources, and verification. All progressive disclosure is local UI state. The optional MCP resource contains no question form, `ui/message`, model-context update, network request, or navigation.

The native detail card is summary-first: it initially shows only the object name, one contextual summary, type, freshness, and a quiet in-card `查看详情` disclosure. Facts, revision, observation time, and sources stay collapsed until requested. This avoids turning a successful point lookup into another dense information surface.

## Codex Desktop compatibility self-check

The workspace companion now reports one explicit private-host compatibility state in `status --json`:

- `qualified`: the exact `app://-/index.html` target, main frame, default main execution context, and renderer lifecycle all passed;
- `unavailable`: the local debug endpoint or transport could not be checked;
- `incompatible`: Codex was reachable but a required private host contract did not match;
- `unchecked`: no refresh has run yet.

Only `qualified` permits the current runtime to be described as attached. `unavailable` and `incompatible` leave the Chat Lane unchanged and expose a bounded diagnostic code. This startup check does not replace the per-build manual selection, disclosure, close, focus, navigation, and virtualization gate.

## Evaluation boundary

`pnpm run benchmark:workspace` measures deterministic component latency in an isolated temporary workspace. It explicitly reports `technical_latency_only`, invokes no model, and creates no Chat Turn. The first recorded local medians were below the 500 ms component target, but this is not evidence that people understand a project faster. Human `time_to_verified_fact`, answer accuracy, lane-leave rate, and Chat Turn reduction must be measured with the counterbalanced protocol in [docs/evaluation-protocol.md](docs/evaluation-protocol.md).

## Reused foundations

- Pure pre-click eligibility with no project-data request.
- Exact key, name, scope-local alias, and normalized matching.
- `0 / 1 / 2–3 / >3` routing without candidate detail prefetch.
- Opaque, time-limited references bound to trusted scope, entity identity, authority, and index revision.
- Fail-closed context/index/provider revalidation.
- Bounded facts, sources, text fallback, timeouts, cancellation, and work budgets.
- Private Codex CDP selection adapter with trusted-click, navigation, context, lifecycle, and stale-response fences.
- Explicitly bound local-workspace file lookup as the first reference Provider.

These foundations are implementation assets. Selection is the visual trigger; it is not permission to add semantic guessing or a browser-first route.

## Current boundaries

- The shipped MCP data is fixture-only.
- The standard MCP App path renders beside a tool result; it does not provide the required ordinary-prose selection hook.
- The private Desktop selection companion is currently the primary interaction prototype, but remains host/build-specific and must be qualified per Codex build.
- Further object/Extractor expansion is paused while cross-build native-host compatibility and scenario-specific summary quality are qualified.
- Markdown artifact, TypeScript/JavaScript module, static test-definition, known JSON configuration, path-qualified ADR, and explicitly authored concept context are implemented. Actual test-run results, task state, and concepts without an explicit identity remain later stages.
- Real Agent work results do not yet systematically emit context references.
- Source files and strict `docs/concepts/*.md` artifacts have real local Providers; other Agent-known concepts, tasks, and verification results are not yet connected.
- A persistent multi-object capsule strip is no longer a default product goal.
- No formal user study has yet proven the expected efficiency gain.

## Research harnesses retained as references

The repository still contains:

- fixture and local-workspace CDP companions;
- App Server referent/session prototypes;
- a browser conversation client;
- host and browser acceptance scripts.

They remain useful for protocol, security, and fallback research. They are not P0 product surfaces and must not be presented as substitutes for the current Codex Desktop Chat Lane.

## Development

```powershell
pnpm install
pnpm run check
pnpm test

# Headless fixture MCP server
node mcp/server.mjs --fixture-root ./fixtures/mini-project --project-id PRJ-01

# Deterministic CLI lookup
"PRD-inline-pointable-widgets.md" | node dist/src/cli.js lookup --stdin --project-dir ./fixtures/mini-project

# Primary Quiet Context Reveal prototype in a controlled Desktop build
node host/workspace-companion.mjs start --presentation-mode mental-model --json
node host/workspace-companion.mjs status --json
node host/workspace-companion.mjs bind --workspace-root 'D:\absolute\workspace' --json
node host/workspace-companion.mjs stop --json

# Isolated rendering acceptance for the zero-turn capsule
pnpm run test:host-browser
pnpm run test:widget-browser
```

After a local Plugin update, reinstall it through the configured local marketplace and use a fresh Codex task so the new MCP tools, resource URI, and Skill are loaded.

## Acceptance focus

P0 is successful only when Quiet Context Reveal:

- leaves the Chat Lane unchanged until a relevant selection is made;
- shows a small action only after local deterministic eligibility;
- performs no Provider read or model call on selection alone;
- opens detail beside the selection after a trusted explicit action;
- does not open a browser or Dashboard;
- creates zero additional Chat Turns;
- does not call a model to reveal existing facts;
- uses type-specific information priorities;
- never infers PASS/FAIL from a test source file and never projects JSON configuration values;
- exposes identity, source, revision, observed time, and freshness;
- pins an opened snapshot, signals detected file revision drift, and refreshes the same card only after a trusted action;
- preserves the old snapshot with an explicit warning when the object is deleted or revision status is unavailable;
- preserves text and structured fallback;
- closes and restores reading context reliably;
- contains no semantic-model or "identify more concepts" path.

The primary research metrics are `time_to_verified_fact`, `chat_turns_to_fact`, fact-answer accuracy, card sufficiency, lane-leave rate, and stale/wrong-entity rate.

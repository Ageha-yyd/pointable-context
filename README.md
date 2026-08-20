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

## Per-build Codex Desktop qualification

The private Chat Lane adapter is qualified per exact Codex Desktop build, never by product-family assumption. `pointable-context-compatibility` validates a strict record under `docs/compatibility/`: the `OpenAI.Codex` package/executable version, the renderer bundle SHA-256, the four automatic host-contract gates, and ten manual interaction gates. Automatic `qualified_current_runtime` is kept separate from manual selection, click, card, disclosure, close/focus, composer, virtualization, navigation, stale-response, and refresh-continuity evidence. A manual PASS/FAIL needs one exact workspace evidence line; an unrun check stays `pending`.

The current `OpenAI.Codex 26.814.5517.0` / executable `151.0.7922.137` record has all four automatic gates and all ten evidence-bound manual gates passing against renderer digest `d00e4620…2855`. It is qualified only for that exact combination; it is not a cross-version support claim. Run the read-only inspector with the actual host version and current bundle:

```powershell
node dist/src/compatibility/qualification-cli.js --workspace-root . --renderer-bundle host/workspace-companion.mjs --host-version 26.814.5517.0 --json
```

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

An open workspace detail card pins the snapshot the user is reading. The bounded v2 background probe fingerprints the selected file stat and, for a verified Git root, its porcelain status, latest selected-file commit, and the bounded literal-reference path set used by the Provider. Explicit concept/change/decision artifacts also bind the stat of their declared workspace evidence source. These signals never enter the card and the probe does not re-project full detail. When the fingerprint changes, the same card shows a quiet `内容已更新` notice. Only a trusted `刷新内容` click performs a new authoritative detail read, reuses the same card DOM in place, preserves its position, scroll, and disclosure state, and shows at most three changed fields. Those explicit-refresh changes appear before the full P-C model and follow type-specific comprehension priority: a Task starts with status/next action/blocker, a Verification with result/unproven boundary/claim, and a Decision with choice/consequence/problem. Duplicate before/after pairs are removed; additions and removals are explicit. An ordinary unrefreshed card has no persistent change panel. This path opens no browser, calls no model, and creates no Chat Turn.

If the file is deleted or the probe becomes unavailable, the prior snapshot stays visible with an explicit warning. Task rebinding, expired references, context drift, or capacity exhaustion disable refresh rather than widening authority. Non-Git workspaces degrade to stat-only. Each Git process is capped at 750ms and 256KiB; a qualifying Git root that cannot be checked reports unavailable. The relation fingerprint detects literal reference membership changes, not runtime dependencies or arbitrary semantic impact.

## Scenario-specific safe projections

The workspace Provider now classifies three additional high-value development artifacts without adding model inference:

- test/spec source files show detected static `test`/`it` titles, current source change evidence, bounded dependencies, and an explicit `not executed` warning. Reading the file never claims PASS or FAIL;
- known JSON configuration files such as `package.json`, `tsconfig*.json`, `.mcp.json`, and Plugin manifests show their purpose and bounded top-level key names. Configuration values and potential secrets never enter the card;
- ADR/decision Markdown paths show only explicit Status, Decision, Context/Rationale, and Consequences sections.

These are conservative projections of readable artifacts, not substitutes for an actual test-run result, runtime configuration resolution, or a semantic decision graph.

## Explicit concept artifacts and presentation pilot

An author can now give a high-value project concept a deterministic identity by placing a strictly structured Markdown artifact under `docs/concepts/*.md`. The format requires meaning, current context, boundary, a 2–4 step process with one explicit current step, an evidence excerpt, and a workspace-relative source line. The Provider verifies that evidence line before returning the card; missing or drifted evidence fails closed. Ordinary prose is still not semantically mined.

The native renderer supports three fixed research conditions over the same detail payload: `record`, `narrative`, and `mental-model`. `mental-model` is the ordinary product default after a single-user formative comparison preferred P-C while judging P-A and P-B similarly. This is a design preference, not efficiency evidence. P-C supports five explicitly authored, evidence-bound structures: `docs/concepts/*.md` for meaning/context/flow/boundary, `docs/changes/*.md` for before/after/impact, `docs/decisions/*.md` for problem/choice/consequence, `docs/tasks/*.md` for task progress, and `docs/verifications/*.md` for claim/result/gap. Exact evidence stays behind an in-card `为什么这样说` disclosure. Research assignments still select one fixed condition when the companion starts; participants never switch conditions inside a task.

## Explicit Agent milestone context

Agent-known stable milestone context can enter the same lightweight Context Index through five strict, file-backed artifacts:

- `docs/concepts/*.md` records meaning, current context, boundary, and a 2–4 step flow;
- `docs/changes/*.md` records before, after, and impact;
- `docs/decisions/*.md` records problem, explicit choice, and consequence;
- `docs/tasks/*.md` records goal, current status, completed work, next step, blocker, update time, and one exact workspace evidence line;
- `docs/verifications/*.md` records claim, explicit result, remaining gap, verification method, verified revision, execution time, and one exact workspace evidence line.

These are author-supplied artifacts, not automatic extraction or conclusions. Ordinary Chat prose, implicit concepts/decisions, TODOs, commits, test filenames, and static test definitions never become context records, “completed”, or PASS/FAIL by inference. Missing fields, identity drift, invalid timestamps, circular evidence, or evidence drift fail closed. The current implementation re-reads these files on demand; it does not require a Dashboard or persistent semantic index.

### Opt-in production policy and post-write gates

Agent milestone context maintenance is opt-in, either for one explicit create/update request or for one bounded long-running task. Authorization does not carry to another task or workspace. An artifact is created or updated only when it has a stable selectable identity, is likely to matter after the current turn, captures an established concept/change/decision or changes status/handoff, and has one exact workspace evidence line. Existing identities are updated instead of duplicated; routine turns, implicit objects, and file edits produce nothing.

`pointable-context-artifact-check` is the read-only post-write gate for Concept/Change/Decision. It validates strict section order, normalized file/H1 identity, exact evidence outside all managed context directories, stable reads, and duplicate stems across the three types. `pointable-context-record-check` continues to validate strict Task/Verification schema, timestamps, exact evidence, and cross-type identity. Neither gate infers, repairs, or writes artifacts; invalid output remains unavailable to the usable Context Index.

### Explicit long-task coverage gate

`pointable-context-coverage` reads a strict `docs/context-coverage.json` declaration for one bounded long task. The declaration names only the Module, Decision, Task, and Verification identities that the user or Agent has explicitly decided must remain recoverable at the current milestone. The gate confirms that every declared key is indexed under the expected type and that the live workspace Provider can return a verified detail snapshot. It also incorporates the Task/Verification record check.

The result separates `coverageRate`, `omissionRate`, `projectionFailureRate`, and `redundancyRate`. It returns identities, revisions, freshness, issue codes, and counts—never selected text, facts, file contents, or configuration values. These measures establish structural coverage against an explicit declaration; they cannot discover an important object that nobody declared, and they are not evidence of human-efficiency improvement.

## Current fixture

The installed MCP server is deliberately pinned to `fixtures/mini-project`. Every result is marked `FIXTURE-ONLY`; it is not evidence about the active workspace.

Development-oriented examples include:

| Key | Capsule type | Demonstrates |
|---|---|---|
| `PRD-inline-pointable-widgets.md` | File / document | purpose, recent change, impact, revision |
| `ContextScopeRef` | Module / concept | definition, responsibility, dependencies, maturity |
| `ARCH-7` | Decision | decision, rationale, alternatives, consequence |
| `NATIVE-CAPSULE-P0` | Task state | goal, completed work, next step, blocker |
| `pilot` | P-C concept | meaning, why now, process position, boundary |
| `presentation-default` | P-C change | before, after, product impact |
| `native-chat-lane` | P-C decision | problem, choice, consequence |
| `work-result-context` | P-C task | goal, status, progress, next step, blocker |
| `task-verification-contract` | P-C verification | claim, explicit result, remaining gap |
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

`pnpm run benchmark:workspace` measures deterministic component latency in an isolated temporary workspace. It explicitly reports `technical_latency_only`, invokes no model, and creates no Chat Turn. The first recorded local medians were below the 500 ms component target, but this is not evidence that people understand a project faster. Short-task presentation/efficiency pilots are currently deferred; later validation will focus on long-horizon context reconstruction after delay, state drift, cross-session resumption, or handoff, using [docs/evaluation-protocol.md](docs/evaluation-protocol.md).

### Frozen study pack v1

The non-inferential facilitator pack in [docs/evaluation/study-v1](docs/evaluation/study-v1/README.md) freezes one P-A/P-B/P-C presentation task and six A/B development lookup tasks. It includes exact-evidence answer units, a privacy-bounded log schema, a deterministic 12-slot Latin-square assignment, and an isolated Git workspace with a reproducible revision mutation. It has not been run, is not the current product gate, and supports no efficiency claim.

`pnpm run study:validate` verifies the evidence lines, privacy fields and schedule balance and returns a `packDigest`. `pointable-context-study assignment --repository-root <root> --slot <1-12> --json` returns the preassigned order and condition for one anonymous slot. Every collected row must retain that digest.

### Controlled long-task study v2 prototype

[docs/evaluation/study-v2](docs/evaluation/study-v2/README.md) defines the controlled long-task experiment proposed for the next validation stage. It uses six frozen development histories, no live model during measured trials, a counterbalanced three-A/three-B schedule, bounded automatic timing and interaction events, participant-visible result preview, public-key encryption, and an explicit GitHub pull-request submission step. Native trial events now feed a strict result pipeline: trial-relative monotonic time and frozen scoring derive objective metrics, six streams receive one session sequence, CSV/event disagreement fails validation, and only a fully validated staging directory is atomically published. The included setup Skill may prepare and diagnose the package, but it must stop at `STUDY READY` and may not answer a measured task or submit data on the participant's behalf.

`pnpm run study-v2:validate` checks the pack contract and digest. `pnpm run build:study-v2 -- --destination <new-absolute-directory> --zip <new-absolute-zip>` creates a prototype release. The current qualification status and remaining release gates are recorded in [IMPLEMENTATION_STATUS.md](docs/evaluation/study-v2/IMPLEMENTATION_STATUS.md); in particular, these materials are not yet an approved participant-data collection release.

The bundled internal runner now supports a resumable two-stage session. `run-native-session` executes or resumes the six assigned trials and stops at `awaiting_questionnaire`; each completed trial is an append-only digest checkpoint bound to the exact participant/slot/session/pack/build tuple. `finalize-native-session` consumes all six without rerunning them, rejects incomplete sessions before mounting a questionnaire, and opens a native five-scale questionnaire in the current Codex Chat Lane. The questionnaire sends no Chat turn, invokes no model, accepts no free text, and publishes the validated result only after all five ratings are submitted. This remains an internal prototype until native usability acceptance and the clean-machine rehearsal are complete.

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
- Further object/Extractor expansion remains subordinate to cross-build native-host compatibility and scenario-specific summary quality.
- Markdown artifact, TypeScript/JavaScript module, static test-definition, known JSON configuration, path-qualified ADR, and explicitly authored concept/change/decision/task/verification context are implemented.
- Agent work results currently enter through explicit Markdown records; no hook or runtime event source decides automatically when a record should be created or updated.
- Static tests remain “not executed.” Actual results require `docs/verifications/*.md`; reliable direct test-run event ingestion is a later stage.
- Concepts without an explicit identity are not connected.
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
pnpm run records:check
pnpm run coverage:check
pnpm run study:validate

# Headless fixture MCP server
node mcp/server.mjs --fixture-root ./fixtures/mini-project --project-id PRJ-01

# Deterministic CLI lookup
"PRD-inline-pointable-widgets.md" | node dist/src/cli.js lookup --stdin --project-dir ./fixtures/mini-project

# Primary Quiet Context Reveal prototype in a controlled Desktop build
# mental-model is the default; pass record or narrative only for a fixed study condition
node host/workspace-companion.mjs start --json
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
- never infers Task completion or Verification success from ordinary Chat, Git state, filenames, or source definitions;
- exposes identity, source, revision, observed time, and freshness;
- pins an opened snapshot, signals detected file revision drift, and refreshes the same card only after a trusted action;
- keeps an open card visible when the user focuses the current Chat composer, so it can remain a reading aid while drafting a reply;
- preserves the old snapshot with an explicit warning when the object is deleted or revision status is unavailable;
- preserves text and structured fallback;
- closes and restores reading context reliably;
- contains no semantic-model or "identify more concepts" path.

The primary research metrics are `time_to_verified_fact`, `chat_turns_to_fact`, fact-answer accuracy, card sufficiency, lane-leave rate, and stale/wrong-entity rate.

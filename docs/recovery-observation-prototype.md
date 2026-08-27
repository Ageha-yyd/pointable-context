# Recovery Observation Prototype

This developer-only prototype validates the measurement contract for natural Pointable Context dogfood and provides an explicit opt-in bridge for native interaction events.

It derives bounded objective metrics from ordered relative-time events for dense-turn, cross-task, and state-drift recovery episodes. Recovery, card-dwell, and navigation timing retain total duration while also subtracting declared inactive intervals for active-time measures. Events may contain only an episode identifier, trigger, sequence, event type, monotonic time, anonymous object digest, bounded failure code, and terminal outcome. Chat text, file content, object names, workspace paths, task identifiers, and authority facts are rejected.

The native bridge remains inactive until a bound task starts one Recovery Episode. The Renderer emits only a strict interaction event type, sequence, and task fence; the Host validates the current task, hashes object identity, and routes the bounded signal into an in-memory episode. Invalid observation input and observer failures are isolated from lookup and card behavior. Explicit completion supplies `resumed_correctly` or `resumed_incorrectly`; the system does not infer human understanding. Companion restart ends the in-memory observation rather than silently resuming it.

The synthetic replay covers a zero-turn cross-task success, a state-drift refresh with inactive time removed, and an ambiguous lookup that aborts instead of fabricating success. The native check covers marked-object activation, manual selection, quick action, object detail, evidence expansion, refresh, close, task isolation, content-field rejection, and existing Renderer behavior in Edge Headless. These outputs are diagnostics. They are not human-efficiency evidence, do not enter the formal study-v2 result pipeline, and do not establish production-build compatibility.

Run it with:

```powershell
pnpm recovery:replay
pnpm recovery:native-check
```

Developer control commands use the running workspace companion and an absolute JSON definition containing only `episodeId`, `trigger`, and `expectedObjectDigest`:

```powershell
node host/workspace-companion.mjs recovery-start --recovery-file D:\absolute\episode.json --json
node host/workspace-companion.mjs recovery-status --json
node host/workspace-companion.mjs recovery-complete --outcome resumed_correctly --json
```

# Recovery Observation Prototype

This developer-only prototype validates the measurement contract for natural Pointable Context dogfood before any native interaction logger is mounted.

It derives bounded objective metrics from ordered relative-time events for dense-turn, cross-task, and state-drift recovery episodes. Recovery, card-dwell, and navigation timing retain total duration while also subtracting declared inactive intervals for active-time measures. Events may contain only an episode identifier, trigger, sequence, event type, monotonic time, anonymous object digest, bounded failure code, and terminal outcome. Chat text, file content, object names, workspace paths, task identifiers, and authority facts are rejected.

The synthetic replay covers a zero-turn cross-task success, a state-drift refresh with inactive time removed, and an ambiguous lookup that aborts instead of fabricating success. The output is a measurement-pipeline diagnostic. It is not human-efficiency evidence, does not enter the formal study-v2 result pipeline, and does not change the native Renderer or plugin behavior.

Run it with:

```powershell
pnpm recovery:replay
```

# Frozen Agent history — training only

The Agent introduced an `orientation gate` after the setup script began opening the workspace before its checksum was verified. The gate now runs after download verification and before any measured trial. It proves only that the packaged environment matches the declared release; it does not prove that a participant understands a later scenario. The next step after the gate is the unscored practice lookup.

Task: select `orientation gate`, open its context, and record one training code. This trial is not scored.

- `TRAIN-A`: verify the packaged environment before the unscored practice lookup.
- `TRAIN-B`: treat the environment check as proof that later answers will be correct.
- `TRAIN-C`: skip the host and release checks because the workspace opened successfully.

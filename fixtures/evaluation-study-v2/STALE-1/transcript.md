# Frozen Agent history — Snapshot Drift

At 09:10 the Agent recorded that the migration was complete. At 11:40 a compatibility failure reopened one remaining item, but the earlier summary was still quoted later in the Chat Lane. The detail associated with that summary is an `observed snapshot`: it accurately represents the 09:10 source revision, not the current task state.

The current record is marked stale and points to a newer source revision. It may be used to understand history, but it must be refreshed before deciding that work is complete. The existence of an old completed status is not an authority conflict; its time and revision explain why it differs.

Task: record one code in `answer.txt`.

- `STALE-A`: accept the 09:10 completed status because it appeared first.
- `STALE-B`: treat both records as invalid because their statuses differ.
- `STALE-C`: treat the older record as historical and refresh against the newer source before deciding.

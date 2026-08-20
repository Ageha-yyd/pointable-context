# Frozen Agent history — Relay Cache

The task began as a single `relay-cache.ts` module. During the long run, the Agent separated persistence from the public entry point, introduced a migration adapter, updated tests, and marked the old direct import as compatibility-only. The first test pass covered serialization but not process restart. Later, the restart fixture passed and the migration adapter remained only for reading version-1 snapshots.

The current public entry is `src/relay-cache/index.ts`. New consumers must not import `src/relay-cache/store.ts`, because that file owns persistence details and may change without a public compatibility promise. The compatibility adapter is still present, so the old filename appearing in the transcript does not make it the supported boundary.

Task: record one code in `answer.txt`.

- `RESUME-A`: import the persistence store directly because it contains the latest implementation.
- `RESUME-B`: import the public relay-cache entry and treat the migration adapter as legacy read support.
- `RESUME-C`: postpone all integration because restart behavior has never been checked.

# Relay Cache project state

## Current phase

The module split and restart fixture are complete. A new consumer must now use the supported boundary.

## relay-cache public entry

`src/relay-cache/index.ts` is the stable consumer entry. `store.ts` remains an internal persistence implementation, and the migration adapter reads version-1 snapshots only.

## Boundary

This decision does not promise a stable store layout.

## Next action

Connect the consumer through the public entry.

# Explicit Refresh project state

## Current decision

The automatic replacement prototype was rejected after it disrupted reading and evidence tracking.

## explicit refresh

Pin the open snapshot, signal detected drift, and replace content only after the user invokes Refresh.

## Boundary

Watchers may detect drift but cannot silently change the visible card.

## Next action

Preserve the in-place refresh flow and its bounded change summary.

# ADR-001: Explicit refresh

## Status

Accepted

## Context

Automatically replacing an open snapshot makes the reader lose the information they were comparing.

## Decision

Detect source revisions in the background, but reload detail only after a trusted explicit refresh action.

## Consequences

The old snapshot remains readable until refresh, and the refreshed content must reuse the same card.

---
module: acp-session-architecture
tags:
  - final-god
  - canonical-projection
  - session-transient-projection
  - capabilities
problem_type: architecture
---

# Canonical Projection Widening

## Problem

Acepe's final GOD architecture requires one authority for session-shaped state. Lifecycle and activity had already moved to Rust-authored canonical envelopes, but TypeScript still carried capability and lifecycle-shaped mirrors through hot state and the deprecated capability bridge. That left readers vulnerable to `canonical ?? hotState` fallback and made hot tool/update events harder to reason about.

## Solution

Widen `CanonicalSessionProjection` to carry all canonical graph truth:

- lifecycle and actionability,
- activity,
- turn state,
- active turn failure and last terminal turn id,
- capabilities: models, modes, commands, config options, autonomous setting, provider metadata, and model display.

Rust emits bounded canonical envelopes for live tool updates and capability changes. TypeScript apply paths carry canonical fields forward from the previous projection when an envelope is intentionally partial. Readers use canonical accessors only; missing canonical projection means the session is not available for that purpose.

## Residual hot-state allowlist

`SessionTransientProjection` may keep only local state with no canonical counterpart:

- `acpSessionId` for local provider-session id mapping,
- `autonomousTransition` for local mutation progress,
- `statusChangedAt` for stable-status display timing,
- `modelPerMode` for local preference memory,
- `usageTelemetry` for local telemetry display snapshots,
- `pendingSendIntent` for immediate send-click disablement while canonical envelopes catch up,
- `localPersistedSessionProbeStatus` for the pre-canonical local-created reattach gate,
- `capabilityMutationState` for local capability mutation progress.

These fields must never assert lifecycle, activity, failure, mode/model, command, config, autonomous, provider metadata, or model-display truth.

## Parity-test pattern

Use a representative `SessionStateGraph` and feed it through both materialization paths:

1. cold open: `replaceSessionOpenSnapshot(graphFromSessionOpenFound(...))`,
2. live stream: `applySessionStateEnvelope(createSnapshotEnvelope(graph))`.

Then compare `getCanonicalSessionProjection()` and canonical capability accessors. This catches divergence where cold replay recomputes part of the projection while live envelopes apply graph fields directly.

## Clearance gates

Before considering the migration closed, scan for:

- bridge references: `SessionCapabilitiesStore`, `ICapabilitiesManager`, `capabilitiesStore`, `session-capabilities-store`,
- forbidden hot-state reads/writes for canonical-overlap fields,
- `canonical ?? hotState` fallback patterns,
- test fixtures that still encode forbidden hot-state shape.

The migration is closed only when those scans are empty and `bun run check`, full Bun tests, Rust library tests, and clippy pass.

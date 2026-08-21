---
title: "Electrobun rebuild — ticket backlog"
type: rebuild
status: active
date: 2026-08-20
---

# Electrobun rebuild — ticket backlog

47 tickets. Rebuild path: adopt an event-sourced orchestration core (decider, projector, event store, projections) and reimplement Acepe's behaviour on it, rather than translating 240,000 lines of Rust.

Parity is proven by the record-and-replay harness (AC-016 to AC-018), never by translation. Nothing in Waves 4 to 7 should start before AC-018 and AC-022 are green.

## Wave graph

```
Wave 0  Spine            AC-001 .. AC-010    mostly serial
Wave 1  Projections      AC-011 .. AC-015    serial after AC-010
Wave 2  Oracle           AC-016 .. AC-018    parallel with Waves 0-1
Wave 3  Shell + slice    AC-019 .. AC-022    AC-020 can start on day one
Wave 4  Providers        AC-023 .. AC-029    fully parallel after AC-023
Wave 5  Projections      AC-030 .. AC-034    fully parallel
Wave 6  Services         AC-035 .. AC-040    fully parallel
Wave 7  Frontend         AC-041 .. AC-044    AC-044 is a wide refactor
Wave 8  Cutover          AC-045 .. AC-047    serial
QA      Live app QA      AC-050              after AC-022 and AC-045
```

## Start-now tickets (no blockers)

- **AC-001** scaffold contracts and pin the Effect catalog
- **AC-016** Rust sidecar over stdio JSON-RPC
- **AC-020** Electrobun shell skeleton, signed

## Highest-value ticket

**AC-018 (replay harness and grader).** Every ticket in Waves 4 to 7 is gradeable in seconds once it exists, and unverifiable until it does. Agent throughput is not the constraint; verification is.

## Pinned toolchain

`effect@4` is at RC. The npm `latest` tag still resolves to `3.22.1`, so an unpinned install silently gives you v3.

| Package | Version |
|---|---|
| `effect` | `4.0.0-rc.111` |
| `@effect/platform-bun` | `4.0.0-rc.111` |
| `@effect/platform-node` | `4.0.0-rc.111` |
| `@effect/sql-sqlite-bun` | `4.0.0-rc.111` |
| `@effect/vitest` | `4.0.0-rc.111` |
| `@effect/language-service` | `0.87.2` (versions independently) |

Implementor model: `cursor-grok-4.6-xhigh` via `cursor-agent`.

## Tickets


### Wave 0 — Spine

- [AC-001](AC-001.md) **Scaffold packages/contracts and pin the Effect catalog** (S) ← start now
- [AC-002](AC-002.md) **Branded id schemas and base schemas** (S) ← AC-001
- [AC-003](AC-003.md) **Orchestration command schema, v1 slice** (M) ← AC-002
- [AC-004](AC-004.md) **Orchestration event schema, v1 slice** (M) ← AC-003
- [AC-005](AC-005.md) **SQLite client layer and migration runner** (M) ← AC-001
- [AC-006](AC-006.md) **Event store table and OrchestrationEventStore service** (M) ← AC-004, AC-005
- [AC-007](AC-007.md) **Command receipt repository** (S) ← AC-006
- [AC-008](AC-008.md) **Pure decider and command invariants** (L) ← AC-004
- [AC-009](AC-009.md) **Pure projector and in-memory read model** (L) ← AC-004
- [AC-010](AC-010.md) **OrchestrationEngine** (L) ← AC-007, AC-008, AC-009

### Wave 1 — Projections

- [AC-011](AC-011.md) **Projection state and per-projector checkpoints** (S) ← AC-006
- [AC-012](AC-012.md) **ProjectionPipeline runner** (L) ← AC-011, AC-010
- [AC-013](AC-013.md) **projection.sessions** (M) ← AC-012
- [AC-014](AC-014.md) **projection.session-messages** (M) ← AC-012
- [AC-015](AC-015.md) **ProjectionSnapshotQuery** (M) ← AC-013, AC-014

### Wave 2 — Oracle

- [AC-016](AC-016.md) **Rust sidecar over stdio JSON-RPC** (L) ← start now
- [AC-017](AC-017.md) **Record harness** (M) ← AC-016
- [AC-018](AC-018.md) **Replay harness and grader** (L) ← AC-017, AC-015

### Wave 3 — Shell and first slice

- [AC-019](AC-019.md) **RPC contract over the Electrobun boundary** (M) ← AC-003, AC-015
- [AC-020](AC-020.md) **Electrobun shell skeleton, signed** (L) ← AC-001
- [AC-021](AC-021.md) **effect-svelte bridge package** (M) ← AC-001
- [AC-022](AC-022.md) **Tracer bullet: create project, create session, send message, stream reply** (L) ← AC-010, AC-015, AC-019, AC-021

### Wave 4 — Providers

- [AC-023](AC-023.md) **ProviderRegistry and ProviderAdapterRegistry** (M) ← AC-022
- [AC-024](AC-024.md) **Claude adapter via claude-agent-sdk** (L) ← AC-023
- [AC-025](AC-025.md) **Codex adapter** (M) ← AC-023
- [AC-026](AC-026.md) **Cursor adapter via ACP** (M) ← AC-023
- [AC-027](AC-027.md) **Copilot adapter** (M) ← AC-023
- [AC-028](AC-028.md) **OpenCode adapter** (M) ← AC-023
- [AC-029](AC-029.md) **Agent installer from the ACP registry** (M) ← AC-023

### Wave 5 — Projections fan-out

- [AC-030](AC-030.md) **projection.turns** (M) ← AC-012, AC-022
- [AC-031](AC-031.md) **projection.session-activities** (M) ← AC-012, AC-022
- [AC-032](AC-032.md) **projection.checkpoints** (M) ← AC-012, AC-022
- [AC-033](AC-033.md) **projection.pending-approvals** (M) ← AC-012, AC-022
- [AC-034](AC-034.md) **projection.projects** (M) ← AC-012, AC-022

### Wave 6 — Services fan-out

- [AC-035](AC-035.md) **Git service** (L) ← AC-018, AC-022
- [AC-036](AC-036.md) **File index service** (L) ← AC-018, AC-022
- [AC-037](AC-037.md) **Checkpoint service** (M) ← AC-018, AC-022
- [AC-038](AC-038.md) **Terminal and PTY service** (M) ← AC-018, AC-022
- [AC-039](AC-039.md) **Skills and MCP catalog service** (M) ← AC-018, AC-022
- [AC-040](AC-040.md) **History importers** (L) ← AC-018, AC-022

### Wave 7 — Frontend

- [AC-041](AC-041.md) **Session store on atoms** (L) ← AC-021, AC-022
- [AC-042](AC-042.md) **Transcript viewport on projections** (L) ← AC-041, AC-014
- [AC-043](AC-043.md) **Agent panel rewrite** (L) ← AC-041
- [AC-044](AC-044.md) **Remove neverthrow and zod, repo-wide** (L) ← AC-021

### Wave 8 — Cutover

- [AC-045](AC-045.md) **Packaging, signing and the differential updater** (M) ← AC-020, AC-022
- [AC-046](AC-046.md) **Parity burn-down** (L) ← AC-024, AC-025, AC-026, AC-027, AC-028, AC-030, AC-031, AC-032, AC-033, AC-034, AC-035, AC-036, AC-037, AC-038, AC-039, AC-040, AC-041, AC-042, AC-043
- [AC-047](AC-047.md) **Delete Rust, Tauri and cargo** (M) ← AC-045, AC-046

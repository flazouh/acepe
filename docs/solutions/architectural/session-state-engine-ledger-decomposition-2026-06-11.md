---
title: Session state engine ledger decomposition and lock order
date: 2026-06-11
category: architectural
module: acp/session_state_engine
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - Splitting a Rust registry or service that owns multiple `Arc<Mutex<HashMap>>` fields
  - Cross-map operations require a documented lock order to avoid deadlock
  - Refactoring session-shaped hot state behind a stable public interface (GOD-gated)
tags: [session-state-engine, lock-order, runtime-registry, anchor-ledger, viewport-ledger, buffer-emission-tracker, adr-0002]
---

# Session state engine ledger decomposition and lock order

## Context

Plan 010 split `SessionGraphRuntimeRegistry` from a ~5,000-line monolith (three `Arc<Mutex<HashMap>>` fields plus supervisor and envelope orchestration) into state-owning sub-modules. Before the split, the only documentation of a critical deadlock constraint lived in inline comments on the registry struct:

```text
// LOCK ORDER: buffer_emissions -> transcript_viewports. Never acquire
// transcript_viewports first ... or the buffer emission method below will deadlock.
```

That comment appeared twice and was easy to violate when new code paths touched both maps. The learnings researcher found **zero** prior lock-ordering docs in `docs/solutions/`. The refactor's payoff is structural enforcement (one module owns both locks) plus this durable write-up.

## Guidance

**Mirror ADR-0002's composed sub-store shape on the Rust side:** disjoint slices, parent as composition root, one-line delegation, tests colocated with the slice they characterize.

```
SessionGraphRuntimeRegistry (spine: supervisor + envelope orchestration)
 ├─ supervisor: Arc<SessionSupervisor>     (unchanged dependency)
 ├─ anchors:   AnchorLedger                (single mutex)
 ├─ viewports: ViewportLedger              (single mutex)
 └─ emissions: BufferEmissionTracker       (single mutex + ViewportLedger dep;
                                            sole dual-lock site)
```

| Module | Owns | Lock scope |
|--------|------|------------|
| `AnchorLedger` | Session anchor timestamps (`record_chunk_timestamp`, per-session monotonic ms) | `session_anchors` only |
| `ViewportLedger` | `TranscriptViewport` map, materialize/finalize, height confirmation, scroll authority | `transcript_viewports` only |
| `BufferEmissionTracker` | `BufferEmissionRecord` map, push/advance/repair envelope builders | `buffer_emissions`; **also** calls into `ViewportLedger` under a fixed order |
| `SessionGraphRuntimeRegistry` | Supervisor, envelope builders, cross-concern orchestration | **No raw map mutexes** — delegates to ledgers/tracker |

**Lock order is an implementation detail of `BufferEmissionTracker`, not a cross-caller contract.**

Acquisition order: **`buffer_emissions` → `ViewportLedger`** (which internally locks `transcript_viewports`). Enforced in one private helper:

```rust
fn with_buffer_emissions_locked<R, F>(&self, f: F) -> R
where
    F: FnOnce(&mut HashMap<String, BufferEmissionRecord>, &ViewportLedger) -> R,
{
    let mut emissions = self.buffer_emissions.lock().expect("...");
    f(&mut emissions, &self.viewports)
}
```

The registry constructs shared ownership explicitly:

```rust
let viewports = ViewportLedger::new();
Self {
    supervisor,
    anchors: AnchorLedger::new(),
    emissions: BufferEmissionTracker::new(viewports.clone()),
    viewports,
}
```

`BufferEmissionTracker` holds a clone of the same `ViewportLedger` instance the registry exposes for single-lock viewport commands. No caller outside the tracker should acquire both mutexes.

**Verification grep:** `rg 'LOCK ORDER' src-tauri/src/acp/session_state_engine/` should match only `buffer_emission_tracker.rs` module header.

**Tests:** Concern-specific characterization lives on each sub-module (`anchor_ledger`, `viewport_ledger`, `buffer_emission_tracker`). Cross-concern envelope flows stay on the registry. The concurrency pin `buffer_emission_and_height_confirmation_concurrent_interleave_completes_without_deadlock` exercises interleaved buffer build + height confirmation under `tokio` and documents the required order structurally (tracker is sole dual-lock holder).

## Why This Matters

Comment-only lock discipline does not survive refactors. When `build_or_advance_viewport_buffer_envelope` materializes a viewport while mutating emission records, inverting acquisition (viewports first, then emissions) deadlocks any path that already holds emissions and waits on viewports.

Centralizing dual-lock work in `BufferEmissionTracker`:

- Makes violation a compile-time/module-boundary concern instead of a comment hunt
- Lets single-lock callers use `ViewportLedger` or `AnchorLedger` without knowing emission ordering
- Preserves the registry's public surface — commands, bridge, and envelope router see one-line delegations (zero consumer churn)

## When to Apply

- New cross-map operations in `session_state_engine` — extend the tracker (or add a new single-purpose dual-lock module), do not add a second dual-lock holder
- Rust decompositions of registries/services with multiple mutex-backed maps — extract single-lock ledgers first, then isolate any required ordering in one dependent module
- Before deleting lock-order comments — ensure `rg 'LOCK ORDER'` has a single authoritative home and a concurrency or structural characterization test gates the extraction

## Examples

**Before (comment-enforced, registry-owned maps):**

```rust
pub struct SessionGraphRuntimeRegistry {
    session_anchors: Arc<Mutex<HashMap<...>>>,
    transcript_viewports: Arc<Mutex<HashMap<...>>>,
    // LOCK ORDER: buffer_emissions -> transcript_viewports ...
    buffer_emissions: Arc<Mutex<HashMap<...>>>,
}
// build_or_advance_viewport_buffer_envelope locks emissions, then viewports — caller must remember
```

**After (structural, tracker-owned ordering):**

```rust
pub struct SessionGraphRuntimeRegistry {
    supervisor: Arc<SessionSupervisor>,
    anchors: AnchorLedger,
    viewports: ViewportLedger,
    emissions: BufferEmissionTracker,
}
// Registry never touches raw HashMap mutexes; dual-lock path is private to BufferEmissionTracker
```

**Testing a single concern without the full registry:**

```rust
let ledger = AnchorLedger::new();
let ms = ledger.record_chunk_timestamp("session-a");
ledger.remove_session("session-a");
// No DB, no supervisor, no viewport/emission maps
```

## Related

- Plan: `docs/plans/2026-06-11-010-refactor-split-runtime-registry-plan.md` (U1–U6)
- ADR-0002: composed sub-stores — TypeScript precedent for the same decomposition shape
- `docs/solutions/architectural/streaming-state-registry-lifecycle-2026-06-11.md` — parallel pattern for per-session hot state lifecycle (DashMap/RefMut ordering in streaming accumulator)
- `docs/solutions/logic-errors/pre-reservation-provider-update-lifecycle-race-2026-04-30.md` — supervisor-only lifecycle invariants preserved through the split (not moved into ledgers)

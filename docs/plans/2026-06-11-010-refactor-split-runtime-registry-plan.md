---
status: complete
type: refactor
created: 2026-06-11
completed: 2026-06-11
document_reviewed: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture 2026-06-11 run 2, candidate 2)
---

# refactor: Split the session-graph runtime registry into state-owning sub-modules

## Summary

`SessionGraphRuntimeRegistry` owns five concerns behind one interface: session anchors, transcript viewports, buffer emissions, envelope-build coordination, and supervisor/graph mutation — with a comment-enforced lock order between two of its three `Arc<Mutex<HashMap>>` fields. Extract the state-owning concerns (anchors, viewports, buffer emissions) into sub-modules that own their locks and invariants internally, leaving the registry as the spine that names and orders them. Mirrors ADR-0002's composed sub-store shape on the Rust side.

**Re-baselined from the architecture review:** the file is 5,007 lines, but ~1,897 are implementation and ~3,110 are the inline `mod tests` (~93 test fns). The split must relocate test blocks alongside extracted concerns — the test module is the larger asset.

---

## Problem Frame

`packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs:108–116`:

```rust
pub struct SessionGraphRuntimeRegistry {
    supervisor: Arc<SessionSupervisor>,
    session_anchors: Arc<Mutex<HashMap<String, Arc<SessionAnchor>>>>,
    transcript_viewports: Arc<Mutex<HashMap<String, TranscriptViewport>>>,
    // LOCK ORDER: buffer_emissions -> transcript_viewports. Never acquire
    // transcript_viewports first ... or the buffer emission method below
    // will deadlock.
    buffer_emissions: Arc<Mutex<HashMap<String, BufferEmissionRecord>>>,
}
```

The lock-order constraint is documented twice (`:112`, `:1218`) as comments callers and maintainers must obey; nothing structural enforces it. The method surface spans five concerns (anchors/lifecycle, supervisor/graph mutation, ~15 envelope builders, viewport materialization, buffer emissions), and a viewport-height confirmation flows through four of them. The inline test module constructs everything through the one struct — heavyweight tests use `sqlite::memory:` + `Migrator::up` + repositories even when targeting a single concern.

The interface is nearly as complex as the implementation: a shallow module at 1,900 lines. The deletion test says the complexity would reappear across every command handler that talks to session state — it earns its keep, but its concerns don't share one interface.

The learnings researcher found **zero** documented lock-ordering/deadlock lessons in `docs/solutions/` — the discipline lives only in these comments. Capturing it structurally (each sub-module owns its locks) and documentarily (compound doc on completion) is part of the payoff.

---

## Requirements

- R1. Each `Arc<Mutex<...>>` field moves into a sub-module that owns the lock and exposes intent-level methods; no caller of the registry can acquire the raw locks.
- R2. The buffer-emissions → viewports lock order becomes an implementation detail inside one sub-module boundary, not a cross-concern comment.
- R3. The registry's public interface is preserved — callers (commands, bridge, envelope router) see one-line delegations; zero consumer churn.
- R4. Lifecycle invariants hold unchanged: `SessionSupervisor` remains the only lifecycle-existence authority; `apply_session_update_with_graph_seed` keeps its no-checkpoint skip guard; pre-reservation buffering and drain-after-reserve ordering are untouched.
- R5. Inline tests relocate with their concern; tests that target one sub-module construct only that sub-module.
- R6. Behavior-preserving throughout; the characterization net is green at every unit boundary.

---

## Scope Boundaries

**Not changing:**
- `SessionSupervisor`, `envelope_router.rs`, `frontier.rs`, `selectors.rs`, `bridge.rs` interfaces (envelope routing is plan 008's territory).
- Envelope payload shapes, projection semantics, or any wire contract.
- The `transcript_viewport/` module family (layout/projection/viewport/row) — the viewport sub-module wraps the registry-side map, not the projection code.

### Deferred to Follow-Up Work
- Moving the ~15 envelope-builder methods into a dedicated builder module — only if plan 008's routing-table split leaves them homeless; otherwise they stay on the spine.
- ADR for Rust-side composed sub-module decomposition (write if this plan's shape proves out, mirroring ADR-0002).

---

## Context & Research

### Relevant Code and Patterns
- `runtime_registry.rs` method surface by concern: anchors (`record_chunk_timestamp:166`, `remove_session:215`, restore fns), supervisor/graph (`apply_session_update:255`, `apply_session_update_with_graph_seed:232`, `replace_capabilities_with_graph_seed:284`), envelopes (`build_capabilities_envelope:312` + ~14 more), viewport (private `with_materialized_viewport`, `finalize_viewport_envelope`, `decide_scroll_authority`), buffer emissions (`build_viewport_buffer_push_envelope_for_session:1142`, `build_or_advance_viewport_buffer_envelope:1220`).
- Private types to move with their concern: `SessionAnchor:56`, `BufferEmissionRecord:99`, `ViewportHeightDiagnostic:1424`, `ViewportMaterializeCtx:1431`.
- ADR-0002 (`docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md`) — the decomposition shape: disjoint slices, parent as composition root, one-line delegation, design-level work with a test net baselined first.
- Test conventions: heavyweight setup via `setup_test_db()` (`sqlite::memory:` + `Migrator::up`); characterization files carry `//!` headers citing the plan.

### Institutional Learnings
- `docs/solutions/logic-errors/pre-reservation-provider-update-lifecycle-race-2026-04-30.md` (**critical**) — supervisor-only lifecycle existence; update paths return `SessionNotFound` rather than inserting; bounded pre-reservation buffer drained after reserve. The invariants most at risk in this split.
- `docs/solutions/logic-errors/deferred-claude-lifecycle-capabilities-race-2026-05-12.md` — the `apply_session_update_with_graph_seed` no-checkpoint skip guard; moving or duplicating it reintroduces a stuck-on-connecting regression.
- `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md` — behavior-through-repositories testing; no source-text contract tests; ready-made regression checklist for identity-adjacent refactors.

---

## Key Technical Decisions

- **Three state-owning sub-modules:** anchor ledger (`session_anchors` + chunk timestamps), viewport ledger (`transcript_viewports` + materialize/finalize/scroll-authority privates), buffer-emission tracker (`buffer_emissions` + the two buffer-envelope builders). Supervisor stays a held dependency, not a slice.
- **The buffer-emission tracker owns the cross-map operation.** `build_or_advance_viewport_buffer_envelope` is the method that forces the lock order; it moves into the tracker, which receives viewport access through a narrow interface (accessor or passed view) so the ordering is encoded structurally in one place.
- **Registry stays the spine.** It holds sub-module instances, delegates one-line, and keeps the envelope-builder methods (they orchestrate across concerns — that's spine work). No facade-of-facades.
- **Tests move with state.** Each extraction takes its test block; tests that needed the full registry only for one concern get rewritten against the sub-module directly. Shared `setup_test_db` helper extracted to a test-support module if needed.
- **Characterization before motion** (ADR-0002 rule 5): U1 pins the lifecycle invariants and the lock-order-sensitive flows before any field moves.

---

## High-Level Technical Design

Directional guidance for review, not implementation specification.

```
SessionGraphRuntimeRegistry (spine: delegation + envelope orchestration)
 ├─ supervisor: Arc<SessionSupervisor>          (unchanged dependency)
 ├─ anchors:   AnchorLedger                     (owns its Mutex)
 ├─ viewports: ViewportLedger                   (owns its Mutex)
 └─ emissions: BufferEmissionTracker            (owns its Mutex;
                owns the emissions→viewport ordering internally)
```

---

## Implementation Units

### U1. Baseline the invariant and lock-order characterization net

**Goal:** Pin the behaviors the split could silently break, before moving anything.
**Requirements:** R4, R6
**Dependencies:** none
**Files:**
- Test: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` (inline tests, to be relocated by later units)

**Approach:** Audit the ~93 existing test fns against the four invariant families; add missing pins. Document the current lock-order rationale in test names/docs so the knowledge survives the comment's deletion.
**Execution note:** Characterization-first; pin current behavior including oddities.
**Test scenarios:**
- Unknown-session update returns `SessionNotFound` and creates nothing (per pre-reservation learning).
- Update arriving for a session without a lifecycle checkpoint is skipped by `apply_session_update_with_graph_seed` (no graph mutation).
- Pre-reservation buffered facts drain in order after reserve; buffer caps enforced; cleanup on failure/close.
- Concurrent buffer-emission build + viewport confirmation on the same session completes without deadlock (exercises the documented lock order under `tokio` concurrency). If a deterministic deadlock pin proves flaky, keep a characterization test that documents the required acquisition order and gate U4 on the tracker being the sole dual-lock holder (structural enforcement, not timing luck).
- `record_chunk_timestamp` monotonicity per session (existing — verify present).

**Verification:** All invariant families have named pins; full suite green.

### U2. Extract the anchor ledger

**Goal:** Smallest slice first — `session_anchors` + timestamp/removal/restore methods.
**Requirements:** R1, R3, R5
**Dependencies:** U1
**Files:**
- Create: `packages/desktop/src-tauri/src/acp/session_state_engine/anchor_ledger.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/{runtime_registry.rs,mod.rs}`

**Approach:** Move `SessionAnchor`, the anchors map, `record_chunk_timestamp`, `anchor_for`, and the anchor-touching parts of `remove_session`/restore into the ledger. Registry delegates. Verbatim bodies; this is the rehearsal extraction that validates the pattern cheaply.
**Test scenarios:**
- Existing anchor tests pass constructed against the ledger alone (no registry, no DB).
- `remove_session` still clears anchors (delegation pin through the registry).

**Verification:** Anchors mutex unreachable outside the ledger; suite green.

### U3. Extract the viewport ledger

**Goal:** `transcript_viewports` + materialization/finalization/scroll-authority privates behind one interface.
**Requirements:** R1, R3, R5
**Dependencies:** U2
**Files:**
- Create: `packages/desktop/src-tauri/src/acp/session_state_engine/viewport_ledger.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`

**Approach:** Move the map plus `with_materialized_viewport`, `finalize_viewport_envelope`, `build_session_viewport_envelope_with`, `decide_scroll_authority`, `height_confirmation_diagnostic_code`, `ViewportHeightDiagnostic`, `ViewportMaterializeCtx`. The ledger exposes intent-level operations (materialize-and-finalize, confirm-height, window queries); the spine's envelope methods call those.
**Test scenarios:**
- Viewport height confirmation produces the same envelope/diagnostic as before for: matching confirmation, stale confirmation, unknown session (`VisibleTranscriptWindowMiss` variants).
- Scroll-authority decisions unchanged across the existing `ScrollIntent` fixture matrix.

**Verification:** Viewports mutex unreachable outside the ledger; viewport tests construct the ledger directly.

### U4. Extract the buffer-emission tracker — and encode the lock order

**Goal:** The deadlock-prone concern gets a module boundary that makes the ordering structural.
**Requirements:** R1, R2, R3, R5
**Dependencies:** U3
**Files:**
- Create: `packages/desktop/src-tauri/src/acp/session_state_engine/buffer_emission_tracker.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`

**Approach:** Move `BufferEmissionRecord`, the emissions map, `build_viewport_buffer_push_envelope_for_session`, and `build_or_advance_viewport_buffer_envelope`. The tracker takes the viewport ledger as a constructor dependency and is the only component that ever holds both locks — acquisition order lives in one private method. Delete the cross-concern lock-order comments; replace with the tracker's own module-header contract.
**Test scenarios:**
- U1's concurrency pin still passes (deadlock-free under interleaving).
- Buffer transition classification and delta-identity consistency unchanged (`classify_buffer_transition`, `buffer_delta_is_identity_consistent` re-export behavior).
- Emission sequence numbers and row versions advance identically to baseline across a push → advance → repair sequence.

**Verification:** `rg 'LOCK ORDER' src-tauri/src/acp/session_state_engine/` matches only the tracker's module header; both maps' mutexes private to their modules.

### U5. Slim the spine and relocate remaining tests

**Goal:** Registry reads as delegation + envelope orchestration; tests live with their concerns.
**Requirements:** R3, R5, R6
**Dependencies:** U4
**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/{anchor_ledger.rs,viewport_ledger.rs,buffer_emission_tracker.rs}` (receive their test blocks)

**Approach:** Move remaining concern-specific tests next to their sub-modules; keep cross-concern envelope-flow tests on the registry. Extract `setup_test_db` into shared test support if duplicated. Verify the registry's public surface is unchanged (compile-level: callers in `commands/`, `bridge.rs` untouched).
**Test scenarios:**
- Test expectation: none new — this unit relocates and reorganizes; the gate is zero test-count loss (compare `cargo test -- --list` counts before/after).

**Verification:** `runtime_registry.rs` under ~800 implementation lines; no caller file changed; suite green with identical test count.

### U6. Capture the lock-ordering knowledge durably

**Goal:** Close the documented gap — lock discipline existed only in comments.
**Requirements:** R2
**Dependencies:** U5
**Files:**
- Create: `docs/solutions/architectural/` compound doc (via `/ce:compound`)
- Modify: `CONTEXT.md` (name the ledger/tracker concepts if they prove durable)

**Approach:** Document the ordering rationale, the tracker-owns-both-locks pattern, and the sub-module decomposition shape for Rust. Propose ADR if the pattern should bind future Rust splits.
**Test scenarios:**
- Test expectation: none — documentation unit.

**Verification:** Compound doc exists; CONTEXT.md updated or consciously skipped.

---

## System-Wide Impact

- **Command handlers / bridge / envelope router** — zero churn (R3); all changes behind the registry interface.
- **Plan 008 (envelope routing-table split)** — same module family. **Sequence this plan after 008 lands** to avoid a merge fight over `envelope_router.rs` adjacency and the builder methods.
- **Plan 012 (streaming lifecycle)** — disjoint files; no coordination needed.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Deadlock introduced by reshuffled lock acquisition | U1 concurrency pin before motion; U4 makes the tracker the only dual-lock holder |
| Lifecycle guard moved or duplicated (stuck-on-connecting regression) | R4 explicitly fences supervisor/seed paths out of scope; U1 pins the skip guard |
| Test-module relocation silently drops tests | U5 gate: identical `cargo test` count before/after |
| Merge conflict with plan 008 | Hard sequencing: start after 008 lands |
| Sub-module boundaries wrong (envelope builders need internal access) | Builders stay on the spine; ledgers expose intent-level ops — revisit only with evidence |

---

## Sources & References

- Architecture review 2026-06-11 run 2, candidate 2
- ADR-0002 (composed sub-stores) — shape precedent
- `docs/solutions/logic-errors/pre-reservation-provider-update-lifecycle-race-2026-04-30.md`
- `docs/solutions/logic-errors/deferred-claude-lifecycle-capabilities-race-2026-05-12.md`
- Related plans: `2026-06-11-008` (envelope routing table — hard predecessor)

---
status: complete
type: refactor
created: 2026-06-11
document_reviewed: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture 2026-06-11 run 2, candidate 4)
---

# refactor: Own the streaming-state lifecycle

## Summary

Per-session streaming state lives in three module-level `LazyLock<DashMap>` statics inside `streaming_accumulator.rs`, and its lifecycle is managed by its callers: `session_update/tool_calls.rs` must drop a `RefMut` before cleanup to avoid deadlock, terminal-status cleanup happens at two call sites, session-close cleanup at a third, and every streaming test must call `cleanup_session_streaming` around itself because state is process-global. Introduce a streaming-state registry whose interface *is* the lifecycle — seed, accumulate, finalize, remove-session — with session keying, lock discipline, and cleanup as implementation. Tests construct registry instances instead of scrubbing globals.

---

## Problem Frame

Evidence in `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs` (1,219 lines, tests from `:712`):

- Three globals: `SESSION_STREAMING_STATES:247`, `PLAN_STREAMING_STATES:316`, `CODEX_PLAN_STATES:348` — three parallel per-session maps with no shared lifecycle.
- `SessionStreamingState { tool_states: DashMap<…> }:83` with `seed_tool_name:96`, `accumulate_delta:129`, `clear_tool:194` — the lifecycle verbs exist but callers must sequence them.
- Cleanup path 1: `session_update/tool_calls.rs:183,205` on terminal tool status, guarded by the comment at `:177` — *"Drop the DashMap RefMut before cleanup_tool_streaming"* (caller-owned deadlock avoidance).
- Cleanup path 2: `commands/session_commands/fork_close.rs:189` (`cleanup_session_streaming` on close).
- Test burden: `session_update/tests.rs:2479–3082` streaming tests bracket themselves with `cleanup_session_streaming`; `tool_calls.rs` tests sprinkle 4 such calls — the canonical pain signal of global state.

Adjacent but distinct: `task_reconciler.rs` (1,537 lines) buffers per-session parent/child state as a **per-connection instance** (`client_loop.rs:323`) — the shape this plan moves the accumulator toward. Its `terminal_tool_call_ids`/`cleanup_task` is a second, independent terminal-lifecycle tracker, and it wraps `merge_tool_arguments` locally (`:441`). Full unification of the two trackers is out of scope; this plan makes the accumulator's lifecycle ownable so a future unification has a seam to use.

---

## Requirements

- R1. One streaming-state registry owns all three per-session maps behind a lifecycle interface: seed → accumulate → finalize(tool, terminal) → remove(session).
- R2. Callers never manage lock/RefMut ordering — the drop-before-cleanup discipline moves inside the registry.
- R3. Terminal-status cleanup is triggered by the registry's `finalize` path, not by caller-side sequencing at multiple sites.
- R4. Tests construct registry instances (or a test-scoped registry) — no test needs `cleanup_session_streaming` brackets for isolation.
- R5. Behavior-preserving: accumulation results, plan/todo/question extraction, and kind-upgrade timing are unchanged. Classification call *targets* are plan 009's territory (U4 there); this plan keeps whatever target is current when it lands.
- R6. Streaming characterization suites (`reconciler/tests/streaming_reducer.rs`, `streaming_semantic_characterization.rs`, `session_update/tests.rs` streaming block) green throughout.

---

## Scope Boundaries

**Not changing:**
- Classification semantics or call targets (plan 009 U4 owns the `semantic_transition`/`detect_tool_kind` routing in this file).
- `TaskReconciler` internals, policy enum, or its per-connection ownership.
- Plan/todo/question normalization output shapes.
- Wire-level session update contracts.

### Deferred to Follow-Up Work
- Unifying the accumulator's and `TaskReconciler`'s terminal-lifecycle tracking behind one module — revisit once both sit behind instance-shaped interfaces.
- Moving plan/todo streaming extraction behind the parser seam (provider-specific streaming policy) — flagged in the architecture review, separate decision.

---

## Context & Research

### Relevant Code and Patterns
- `streaming_accumulator.rs:83–364` — state types, globals, accessors (`get_session_streaming_state{,_mut}:251,261`), plan API (`is_plan_file_path:364`, `accumulate_plan_content:387`, `finalize_plan_streaming:432`).
- `session_update/tool_calls.rs:123–230` — `build_tool_call_update_from_raw` drives the streaming flow and owns cleanup sequencing today.
- `task_reconciler.rs` + `client_loop.rs:323` — the per-connection instance pattern to mirror for ownership scope.
- Registry/instance precedent: `SessionGraphRuntimeRegistry` (held state with intent-level methods).

### Institutional Learnings
- `docs/solutions/logic-errors/pre-reservation-provider-update-lifecycle-race-2026-04-30.md` — lifecycle-existence rules; the registry must not become a place where provider events create session-shaped truth.
- `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md` — the accumulator's documented responsibility: "accumulation, classification via `semantic_transition`" — this plan keeps that boundary.
- No documented DashMap/lock-lifecycle lessons exist in `docs/solutions/` — capture one via `/ce:compound` on completion.

---

## Key Technical Decisions

- **Registry instance owned at app/connection scope, statics retired.** The three `LazyLock` globals collapse into one `StreamingStateRegistry` struct holding the three maps (tool, plan, codex-plan) keyed by session. Production wiring passes it where `get_session_streaming_state_mut` is called today; the global access pattern is replaced, not wrapped. If threading the instance through all call paths proves disproportionate at implementation time, fallback is a single process-scoped instance with the same interface — the interface, not the storage, is the contract (deferred-to-implementation decision, see Open Questions). A process-scoped fallback still satisfies R4 only if tests construct through a fresh registry handle that resets per-test state (constructor or explicit `reset_for_test()`), not by reusing dirty shared maps.
- **`finalize` is the only cleanup verb for tools.** Terminal-status handling in `tool_calls.rs` calls `registry.finalize_tool(...)`; the RefMut-drop ordering is private to the registry. `remove_session` is the only session-scoped cleanup, called from close paths.
- **Three maps stay three maps internally.** Tool streaming, plan streaming, and codex-plan states have different value shapes; unifying their records is not required to unify their lifecycle.
- **Test isolation via construction.** Unit tests build a fresh registry; the global-scrub brackets get deleted, not relocated.

---

## Open Questions

### Deferred to Implementation
- Whether the registry instance threads through `client_loop`/dispatch naturally or a process-scoped instance is the pragmatic landing point — decide when the call-path threading cost is visible. Either satisfies R1–R4.

---

## Implementation Units

### U1. Pin streaming lifecycle behavior, including the cleanup-burden seams

**Goal:** Characterize what callers do today so the registry can absorb it faithfully.
**Requirements:** R5, R6
**Dependencies:** none
**Files:**
- Test: `packages/desktop/src-tauri/src/acp/reconciler/tests/streaming_reducer.rs` (extend)
- Test: `packages/desktop/src-tauri/src/acp/session_update/tests.rs` (audit streaming block)

**Approach:** Verify the existing suites pin: seed → delta → terminal cleanup sequencing; plan-content accumulation/finalization; cross-session isolation; the deadlock-sensitive drop-then-cleanup flow under concurrency. Add missing pins.
**Execution note:** Characterization-first.
**Test scenarios:**
- Tool streamed to terminal status leaves no residual per-tool state (cleanup pin).
- Two sessions streaming the same tool-call id stay isolated.
- Plan-file path detection → accumulate → finalize round-trip output unchanged.
- Concurrent delta + terminal update on one tool does not deadlock (tokio interleaving).

**Verification:** Each caller-owned lifecycle step has a named pin.

### U2. Introduce `StreamingStateRegistry` and absorb the three globals

**Goal:** One owner; lifecycle verbs on the interface; lock discipline inside.
**Requirements:** R1, R2
**Dependencies:** U1
**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs`
- Modify: callers of `get_session_streaming_state{,_mut}` / plan APIs (compiler-driven)

**Approach:** Define the registry struct holding the three maps; move `seed_tool_name`/`accumulate_delta`/`clear_tool`/plan APIs onto it as session-keyed methods (`seed`, `accumulate`, `finalize_tool`, `accumulate_plan`, `finalize_plan`, `remove_session`). The RefMut-drop ordering becomes a private implementation note with a test. Wire the production instance per the Key Technical Decision (threaded or process-scoped).
**Test scenarios:**
- All U1 pins pass against the registry interface.
- `finalize_tool` performs the drop-before-cleanup internally: same concurrency pin as U1, now without caller-side sequencing.

**Verification:** `rg 'LazyLock' src-tauri/src/acp/streaming_accumulator.rs` shows no per-session state statics (or only the fallback single instance, if that decision lands); `tool_calls.rs:177`'s ordering comment is gone.

### U3. Collapse the cleanup call sites onto the lifecycle verbs

**Goal:** Terminal cleanup at two sites and close cleanup at a third become `finalize_tool` / `remove_session`.
**Requirements:** R3
**Dependencies:** U2
**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands/fork_close.rs`

**Approach:** Replace caller-side cleanup choreography with the registry verbs. `build_tool_call_update_from_raw` calls `finalize_tool` exactly where terminal status is decided; `fork_close.rs` calls `remove_session`.
**Test scenarios:**
- Terminal tool update via the full `tool_calls.rs` path leaves no residual state (U1 pin, now through the new seam).
- Session close removes all three state families for that session and no other.

**Verification:** `rg 'cleanup_session_streaming|cleanup_tool_streaming' src-tauri/src/` matches only the registry's internals (or nothing, if renamed).

### U4. Delete test-side global scrubbing; capture the lesson

**Goal:** Tests construct registries; the institutional gap gets a doc.
**Requirements:** R4
**Dependencies:** U3
**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tests.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs` (test block)
- Create: `docs/solutions/` compound doc (via `/ce:compound`)

**Approach:** Streaming tests build fresh registry instances (or fresh process-scoped instance per test via constructor). Delete all `cleanup_session_streaming` brackets. Write the compound doc on per-session state lifecycle ownership (globals → instance, finalize-owns-ordering).
**Test scenarios:**
- Full streaming suite green with zero cleanup brackets and tests runnable in any order (run twice, shuffled, to prove isolation).

**Verification:** `rg 'cleanup_session_streaming' src-tauri/src/ --glob '**/tests*'` empty; suite green under `cargo test -- --test-threads=8`.

---

## System-Wide Impact

- **Plan 009 (tool identity)** — same file. 009's U4 changes which classification function the accumulator calls; this plan changes who owns the state around it. **Sequence: land 009 U4 first** (small, call-target-only), then this plan rebases trivially.
- **Plan 010 (runtime registry)** — disjoint files; no coordination.
- **`TaskReconciler`** — untouched; future unification gains a seam.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Deadlock regression when ordering moves inside the registry | U1/U2 concurrency pins; ordering lives in one private method with a doc-comment contract |
| Threading the instance through call paths balloons the diff | Explicit fallback decision (process-scoped instance, same interface) deferred to implementation |
| Hidden callers of the global accessors | Compiler-driven: deleting the statics surfaces every caller |
| Conflict with plan 009 on `streaming_accumulator.rs` | Hard sequencing: 009 U4 lands first |

---

## Sources & References

- Architecture review 2026-06-11 run 2, candidate 4
- `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`
- `docs/solutions/logic-errors/pre-reservation-provider-update-lifecycle-race-2026-04-30.md`
- Related plans: `2026-06-11-009` (hard predecessor for the shared file), `2026-06-11-015`

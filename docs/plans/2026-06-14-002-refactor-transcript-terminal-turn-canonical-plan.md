---
title: "refactor: Retire transcript projection's private terminal-turn state machine"
type: refactor
status: active
created: 2026-06-14
depth: deep
posture: characterization-first
---

# refactor: Retire transcript projection's private terminal-turn state machine

## Problem Frame

A pending Bash permission / tool call appears in the **Attention Queue** but never appears in the **chat transcript** once a turn has errored. Root cause is a GOD-architecture violation: the same canonical concept — *"is this session currently preserving a terminal (errored/cancelled) turn?"* — is computed by **two independent state machines that have drifted**.

- **Canonical owner (correct):** `SessionStateGraph`, via `src-tauri/src/acp/projections/session_lifecycle.rs` + `src-tauri/src/acp/projections/mod.rs`. It exposes `preserves_terminal_turn(snapshot)` over `SessionSnapshot.turn_state` / `active_turn_failure` / `last_terminal_turn_id`, and resets on a new turn via `start_running_turn()` (`UserMessageChunk` / first agent chunk → `turn_state=Running`, `active_turn_failure=None`, `last_terminal_turn_id=None`).
- **Divergent duplicate (buggy):** `src-tauri/src/acp/transcript_projection/runtime.rs` keeps its **own** fields `turn_guard`, `has_active_turn_failure`, `last_terminal_turn_id` and a private `preserves_terminal_turn(&self)` (runtime.rs:171). Its `UserMessageChunk` arm never resets the guard, so once a turn fails it suppresses **every** subsequent turn's `ToolCall` / `AgentMessageChunk` / `AgentThoughtChunk` / `ToolCallUpdate` forever — including the tool call of a turn the user just re-prompted.

There are **three** copies of `preserves_terminal_turn` in Rust (`projections/mod.rs:48`, `projections/projection_apply_router.rs:38`, `transcript_projection/runtime.rs:171`). The first two read the shared `SessionSnapshot`; the third invents its own fields and is the divergent authority.

**Goal:** one owner, one reset rule. Extract the canonical terminal-turn decision into a single reusable guard, delete the transcript projection's private fields, and have the transcript projection **consume** the canonical decision (passed in as an explicit parameter) at both the live and resume/replay seams.

---

## Scope Boundaries

**In scope**
- Consolidate the canonical terminal-turn decision into one reusable owner; collapse the three `preserves_terminal_turn` copies.
- Delete the transcript projection's private terminal-turn fields and private predicate.
- Thread the canonical decision into the transcript projection's `apply_session_update` as a required parameter (compile-time ordering contract).
- Update both apply seams: live dispatch (`ui_event_dispatcher/persistence.rs`) and resume/replay rebuild (`session_journal.rs`, `session_materialization`, `client_transport`).
- Preserve existing within-same-turn straggler suppression behavior.

**Out of scope / non-goals**
- Changing the canonical *semantics* of terminal-turn preservation or the reset rule (we reuse the correct canonical logic, not redefine it).
- The Attention Queue / permission-tracker path (already correct).
- Any TypeScript or `packages/ui` change — this is a Rust-canonical fix; the UI already projects whatever the canonical transcript contains.
- Transcript revision/reconciliation mechanics (`snapshot_revision`, dispatcher delta reconciliation).

### Deferred to Follow-Up Work
- Auditing other consumers (operation graph, interaction graph) for similar private re-derivation of canonical turn state — flag only; not part of this PR.

---

## Key Technical Decisions

> **Document review correction.** The first draft framed this as a clean, behavior-preserving swap of one shared predicate. Review proved that false: the transcript's private guard and the canonical guard encode **genuinely different reset rules** and the live seam sampled the decision at the **wrong point**. The decisions below resolve those findings. This is a *deliberate unification of two divergent rules*, not a mechanical consolidation.

- **B — explicit parameter (chosen).** The transcript projection receives the terminal-turn decision as a required argument to `apply_session_update`, rather than reading hot/canonical state internally or filtering post-projection. This makes the ordering a **compile-time contract**. Rejected alternatives: (a) read `SessionSnapshot` inside the transcript runtime — implicit ordering assumption + couples the registries; (c) post-projection filter — re-introduces a second decision site. Also rejected: the one-line patch (reset the transcript's own guard on `UserMessageChunk`) — it makes the red test pass but leaves three divergent copies alive, which is the exact failure this work exists to remove.

- **Unified rule = the canonical rule (the route decision).** The single rule both projections consume is the canonical router's per-event decision (`projection_apply_router.rs` `route_projection_apply`): for each event, *should this event be suppressed because a terminal turn is preserved, and does applying it reset the guard?* The canonical guard resets on **any non-suppressed transcript-bearing event** (`UserMessageChunk`, and the first `AgentMessageChunk` / `AgentThoughtChunk` / `ToolCall` / `ToolCallUpdate` of a new turn, gated by `!preserves_terminal_turn`), not only on `Turn*` events. The transcript runtime adopts this rule wholesale. **Consequence:** some existing `skips_*` expectations may legitimately change; each is re-derived from the unified rule and re-asserted intentionally (not blindly kept green). The within-same-turn straggler suppression the tests care about is preserved *because the route gate suppresses those events before they can reset* — that gating must live **inside** the guard, not only in the router.

- **Pre-apply sampling (the decision is computed before the event mutates canonical state).** The decision threaded to the transcript apply is the route decision for the event computed against the state **before** the canonical reducer advances on that event. This is mandatory for correctness: the canonical `TurnError` arm flips `turn_state=Failed` *before* the transcript apply, so a post-apply sample would report `preserve=true` for the `TurnError` event itself and **suppress the Error row that must render**. The guard therefore exposes a **decide-then-advance** API: `route(update) -> RouteDecision` returns the decision from current state, and the caller advances the guard after. Live and replay both follow decide-then-advance, so they are identical by construction over the same ordered event stream — eliminating the two-instances divergence risk.

- **Single driver, two seams.** The guard owns both the route gate (suppress?) and the transitions (reset/fail/cancel/ignore-late). The canonical lifecycle reducer advances **via** the guard (replacing the `route_projection_apply` + `session_lifecycle.rs` arm logic for terminal-turn fields). Live (`persistence.rs`) captures the guard's `RouteDecision` for the event and passes it to the transcript apply; replay (`session_journal.rs`) advances its own guard with the same decide-then-advance discipline. Because both derive from the *one* guard implementation fed the *same ordered events*, parity holds structurally; the parity test is a regression net, not the primary guarantee.

- **`should_ignore_late_turn_failure` `turn_id == None` delta.** The transcript runtime's current late-match (runtime.rs:206) has an extra `turn_id.is_none()` disjunct the canonical helper lacks. Under the unified rule we adopt the **canonical** semantics and pin the `turn_id == None` late-error case with an explicit test so the behavior change is deliberate and visible.

- **Characterization-first posture.** High-risk canonical path with an intended behavior change. The already-written red test is the headline delta; the `skips_*` suite is re-derived from the unified rule (U2); a live-vs-replay parity suite (U4) covers late-duplicate `Turn*`, `turn_id == None` late errors, and the suppressed-event-does-not-advance case.

---

## High-Level Technical Design

*Directional guidance for review, not implementation specification.*

```text
   TerminalTurnGuard  <-- ONE owner: route gate (suppress?) + transitions
     state: turn-terminal view, active_turn_failure, last_terminal_turn_id
     API:  route(update) -> RouteDecision { suppress, resets, ignore_late }   (pure, pre-advance)
           advance(update)                                                    (mutates state)

   Per event, every driver does DECIDE-THEN-ADVANCE:
        decision = guard.route(update)   // computed from state BEFORE this event
        ...apply using `decision`...
        guard.advance(update)            // now mutate guard state

   LIVE seam (persistence.rs):
        decision = canonical guard.route(update)   // captured PRE-apply
        canonical reducer advances (via guard)
        transcript_projection.apply_session_update(event_seq, update, decision)  <-- required param

   REPLAY seam (session_journal.rs rebuild loop):
        own guard instance, same decide-then-advance over the same ordered events
        => byte-identical decisions to live, by construction

                 transcript apply uses `decision`:
                   decision.suppress  -> skip straggler
                   else               -> append row   (TurnError row still renders:
                                                        decision sampled before the
                                                        Failed transition)
```

The transcript runtime loses `turn_guard` / `has_active_turn_failure` / `last_terminal_turn_id` / `TranscriptTurnGuard` and its private `preserves_terminal_turn`. Its terminal-event arms stop mutating guard state and stop computing late-match locally; every append-vs-skip and skip-late choice reads the passed-in `RouteDecision`.

---

## System-Wide Impact

- **Apply seams touched:** the production callers of `TranscriptProjectionRegistry::apply_session_update` are exactly the live dispatch seam (`ui_event_dispatcher/persistence.rs`) and the journal replay rebuild loop (`session_journal.rs:351`, inside `rebuild_local_transcript_snapshot_until`, which also backs the completed-snapshot variant). `session_materialization/mod.rs:47` and the `client_transport.rs` sites call the **`ProjectionRegistry`** (canonical), not the transcript registry, and are out of scope. The compiler-enforced signature change will flag every real caller plus the large set of transcript-registry **test** callers (runtime.rs, display-id tests, `ui_event_dispatcher/tests.rs`, etc.) — that churn is mechanical but expected.
- **Resume note:** `TranscriptSnapshot` persists only `revision` + `entries`; the guard is already a replay/live-only construct and `from_snapshot` resets it. So there is no persisted-state migration — only the recompute paths change.
- **Affected parties:** end users (the missing tool row reappears in chat after a re-prompt following an error); no API/CLI/env surface.

---

## Implementation Units

### U1. Extract the single canonical terminal-turn guard

**Goal:** Create the single owner of the terminal-turn rule — a guard that owns both the **route gate** (suppress?) and the **transitions** (reset/fail/cancel/ignore-late), exposed as a **decide-then-advance** API — and route the canonical projection through it, collapsing the `projections/mod.rs:48` and `projections/projection_apply_router.rs:38` copies onto it.

**Requirements:** Establishes the single authority the transcript projection consumes. Foundation for the GOD fix; encodes the unified rule and pre-apply sampling from Key Technical Decisions.

**Dependencies:** none.

**Files:**
- `src-tauri/src/acp/projections/terminal_turn_guard.rs` (new — guard struct; `route(update) -> RouteDecision` pure pre-advance method embedding the `preserves_terminal_turn` gate; `advance(update)` mutating method with the `start_running_turn` reset / `Failed` / `Cancelled` / ignore-late transitions; `RouteDecision { suppress, resets, ignore_late }`)
- `src-tauri/src/acp/projections/mod.rs` (route `preserves_terminal_turn` / `start_running_turn` through the new guard; re-export the guard + `RouteDecision`)
- `src-tauri/src/acp/projections/session_lifecycle.rs` (delegate the terminal-turn field transitions to `guard.advance`; the per-event-kind reset gating now lives in the guard, not in the arm bodies)
- `src-tauri/src/acp/projections/projection_apply_router.rs` (remove the duplicate `preserves_terminal_turn` / `should_ignore_*`; the route gate now comes from `guard.route`)
- `src-tauri/src/acp/projections/terminal_turn_guard.rs` tests (inline `#[cfg(test)]`)

**Approach:** Move the **complete** terminal-turn rule into the guard — not just the `Turn*` transitions but the per-event-kind gating that currently lives in the router/reducer: `route(update)` returns `suppress` (true when `preserves_terminal_turn` holds and the event is a transcript-bearing straggler), `resets` (true when applying this event clears the terminal state — `UserMessageChunk` always; first non-suppressed `AgentMessageChunk` / `AgentThoughtChunk` / `ToolCall` / `ToolCallUpdate`), and `ignore_late` (the `should_ignore_turn_complete` / `should_ignore_late_turn_failure` match, canonical `turn_id` semantics). `advance(update)` then mutates state. The canonical `SessionSnapshot` fields stay where they are; the lifecycle reducer sets them strictly **via** `guard.advance` so there is exactly one driver. This is **not** a pure consolidation — it deliberately makes the canonical rule the single rule (see Key Technical Decisions); characterization tests prove the *canonical* outputs are unchanged.

**Execution note:** Characterization-first — pin current canonical `SessionSnapshot` behavior (turn_state / active_turn_failure / last_terminal_turn_id across a representative event sequence, including late-duplicate `Turn*` and `turn_id == None`) **before** moving the logic, so the guard is proven equivalent to today's canonical reducer.

**Patterns to follow:** existing `preserves_terminal_turn` / `start_running_turn` in `projections/mod.rs`; `route_projection_apply` and `should_ignore_*` in `projection_apply_router.rs`; the `ProjectionApplyArm` match in `session_lifecycle.rs`.

**Test scenarios:**
- `route` after TurnError: a same-turn straggler `ToolCall` → `suppress=true, resets=false`; TurnComplete → not suppressed; TurnCancelled straggler → `suppress=true`.
- `route` for `UserMessageChunk` after TurnError → `suppress=false, resets=true`; then `advance` clears `last_terminal_turn_id`.
- First `AgentMessageChunk` / `AgentThoughtChunk` / `ToolCall` of a new turn after a terminal turn → `route` returns `resets=true` only when not suppressed (encodes the `!preserves_terminal_turn` gate); a *same-turn* straggler of the same kind returns `suppress=true, resets=false`.
- Late duplicate TurnComplete/TurnError with matching `turn_id` → `ignore_late=true`; non-matching → false; **`turn_id == None` late error → canonical semantics (`ignore_late=false`)**, pinned explicitly as the chosen behavior delta.
- **Decide-then-advance ordering:** `route(TurnError)` computed before `advance(TurnError)` returns `suppress=false` (the Error event itself is not suppressed); only a *subsequent* straggler is suppressed.
- Characterization: canonical `SessionSnapshot.turn_state` / `active_turn_failure` / `last_terminal_turn_id` outputs are byte-identical to the pre-refactor reducer for a representative recorded sequence.

**Verification:** `projections` test suite green; characterization sequence unchanged; `mod.rs` and `projection_apply_router.rs` no longer define their own `preserves_terminal_turn` / `should_ignore_*`; the guard is the sole definition.

---

### U2. Transcript projection consumes the decision; delete its private state machine

**Goal:** Remove `turn_guard`, `has_active_turn_failure`, `last_terminal_turn_id`, the `TranscriptTurnGuard` enum, and the private `preserves_terminal_turn(&self)`; drive suppression and late-terminal skipping from a passed-in pre-apply `RouteDecision`.

**Requirements:** The core GOD fix. Makes the red test pass under the unified rule (Key Technical Decisions) while keeping legitimate within-same-turn straggler suppression.

**Dependencies:** U1.

**Files:**
- `src-tauri/src/acp/transcript_projection/runtime.rs` (signature change on `apply_session_update` / `apply_session_update_inner` to accept the `RouteDecision`; delete fields + enum + predicate; replace `self.preserves_terminal_turn()` checks at runtime.rs:182/187/192/200/205/214 with `decision.suppress`; replace local late-match at runtime.rs:205–217 with `decision.ignore_late`; remove guard mutations at runtime.rs:360–376; `from_snapshot` no longer carries guard fields)
- `src-tauri/src/acp/transcript_projection/runtime.rs` tests (the `skips_*` tests + the red test compile against the new signature and are **re-derived** from the unified rule)

**Approach:** `apply_session_update(event_seq, update, decision: RouteDecision)`. The suppression checks read `decision.suppress`; the late-terminal skip reads `decision.ignore_late`. The TurnError/TurnComplete/TurnCancelled arms still append/close their transcript entries (the "Error" row renders because the decision is sampled **pre-apply** — `decision.suppress=false` for the terminal event itself) but no longer mutate any guard field. **Re-derive, do not blindly preserve, the `skips_*` tests:** each is updated to feed the `RouteDecision` the unified guard produces for that event; where the unified rule changes an outcome vs. the old private guard, change the assertion deliberately and document why in the test. `appends_tool_call_for_new_turn_after_terminal_turn_error` passes when fed the post-reset decision (the guard reset on the intervening `UserMessageChunk`).

**Execution note:** Red test already written (`appends_tool_call_for_new_turn_after_terminal_turn_error`). Treat any `skips_*` assertion that must flip under the unified rule as an intentional characterization update, not a regression.

**Patterns to follow:** existing `apply_session_update` shape and the `TranscriptDeltaOperation` return.

**Test scenarios:**
- *Covers the bug:* TurnError → UserMessageChunk → ToolCall, decision derived from a guard that reset on the user turn → ToolCall **appends** a row (the existing red test).
- TurnError → ToolCall with `decision.suppress = true` (same turn) → no row (re-derived skip test).
- TurnCancelled → AgentThoughtChunk with `decision.suppress = true` → no row; after a new user turn → appended.
- ToolCallUpdate after terminal turn with `decision.suppress = true` → suppressed.
- The `TurnError` event itself, fed its **pre-apply** decision (`suppress = false`) → the Error row still appends (regression guard for the sampling-point bug).
- Late duplicate TurnComplete with `decision.ignore_late = true` → not re-rendered.
- Build check: no references to `turn_guard` / `TranscriptTurnGuard` / `has_active_turn_failure` / `preserves_terminal_turn` remain in `transcript_projection/`.

**Verification:** `cargo test -p acepe transcript_projection` green including the previously-red test; `rg 'turn_guard|TranscriptTurnGuard|has_active_turn_failure' src-tauri/src/acp/transcript_projection` returns nothing.

---

### U3. Thread the decision at the live dispatch seam

**Goal:** In `persist_dispatch_event`, capture the canonical `RouteDecision` for the event **before** the canonical reducer advances on it, and pass that pre-apply decision into the transcript apply.

**Requirements:** Live correctness for the bug; encodes the pre-apply sampling contract (Key Technical Decisions).

**Dependencies:** U1, U2.

**Files:**
- `src-tauri/src/acp/ui_event_dispatcher/persistence.rs` (compute `decision = canonical guard.route(update)` from current state, **then** `projection_registry.apply_session_update_at_event_seq` advances, **then** pass `decision` to `transcript_projection_registry.apply_session_update`)
- `src-tauri/src/acp/projections/mod.rs` (expose a `ProjectionRegistry` method that returns the pre-apply `RouteDecision` for a session+update without mutating, e.g. `route_terminal_turn(session_id, update)`)

**Approach:** **Do not** read the decision from the post-apply snapshot — that is the sampling-point bug the review caught (the `TurnError` event would self-suppress its own Error row). Sample first via the guard's pure `route`, advance canonical, then apply transcript with the captured decision. Decide-then-advance, matching U4 exactly so live and replay are identical by construction. U2 made the parameter required, so this site cannot silently regress.

**Patterns to follow:** the existing ordered `apply_session_update_at_event_seq` → `transcript_projection_registry.apply_session_update` sequence in `persistence.rs`; the pure-route shape of `route_projection_apply`.

**Test scenarios:**
- Integration: drive `TurnError → UserMessageChunk → ToolCall` through the dispatch persistence path; assert the transcript snapshot contains **both** the Error row (TurnError not self-suppressed) and the tool row.
- Same-turn straggler after error via the live path → suppressed.
- Sampling-point regression: a single `TurnError` event through the live path renders the Error row (would fail if the decision were sampled post-apply).

**Verification:** dispatcher/persistence tests green; live QA in U5 shows the row; the live path produces the same entries as the U4 replay parity test for shared sequences.

---

### U4. Thread the decision at the resume/replay rebuild seam

**Goal:** Make journal-replay transcript rebuild produce identical suppression to live by running the **one** guard with the same decide-then-advance discipline over the same ordered events.

**Requirements:** Resume consistency — a reopened session must show the same transcript as the live one.

**Dependencies:** U1, U2.

**Files:**
- `src-tauri/src/acp/session_journal.rs` (`rebuild_local_transcript_snapshot_until` at the `registry.apply_session_update` call ~line 351, plus the completed-snapshot variant that delegates to it: hold a `TerminalTurnGuard`; per event in `event_seq` order do `decision = guard.route(update)` → `registry.apply_session_update(seq, update, decision)` → `guard.advance(update)`)

**Approach:** Use the **decide-then-advance** sequence verbatim (same as U3). Because the guard owns the route-skip gating (U1), the replay loop does **not** need to re-implement the router's suppression logic — feeding raw journal events through `guard.route`/`guard.advance` reproduces the canonical decisions exactly. This keeps transcript rebuild decoupled from the full `ProjectionRegistry` while consuming the one guard. Ordering by `event_seq` is already enforced (`ordered_events.sort_by_key`); the completed-snapshot variant inherits the same path via delegation.

**Execution note:** Characterization-first — capture a resume rebuild over a journal containing `TurnError → UserMessageChunk → ToolCall` and assert the rebuilt snapshot includes the tool row (and the Error row).

**Patterns to follow:** existing replay loops in `session_journal.rs` (`rebuild_session_projection`, `rebuild_local_transcript_snapshot_until`).

**Test scenarios:**
- Rebuild from a synthetic journal: TurnError → UserMessageChunk → ToolCall → rebuilt transcript includes both the Error row and the tool row.
- Rebuild where ToolCall is a true same-turn straggler after TurnError (no intervening user turn) → row suppressed.
- **Live-vs-replay parity (the divergence net):** for each of these sequences, the entries produced by the live `persist_dispatch_event` path (U3) and the replay rebuild are identical — (a) terminal error then re-prompt then tool call; (b) late-duplicate `TurnComplete`/`TurnError` with matching and non-matching `turn_id`; (c) a `turn_id = None` late error; (d) a suppressed straggler that must **not** advance the guard.

**Verification:** `session_journal` + `session_open_snapshot` tests green; the live-vs-replay parity suite passes for all four sequence classes.

---

### U5. Verification, QA, and dead-code sweep

**Goal:** Prove the fix end-to-end and confirm no orphaned terminal-turn logic remains.

**Requirements:** Done-criteria for the whole change.

**Dependencies:** U1–U4.

**Files:**
- (verification only) `src-tauri` test run, `cargo clippy`
- dev-app QA via the repo QA wrapper

**Approach:** Run the full relevant Rust suites and clippy. Then QA the live dev app through the bridge: reproduce the screenshot scenario (terminal error → re-prompt → pending Bash permission) and confirm the tool row now renders in the chat transcript, matching the Attention Queue.

**Test expectation:** none new — this unit runs the suites and live QA built in U1–U4.

**Test scenarios:**
- `cargo test -p acepe transcript_projection projections session_journal session_open_snapshot` all green, including `appends_tool_call_for_new_turn_after_terminal_turn_error`.
- `cargo clippy` clean for `src-tauri`.
- `rg 'preserves_terminal_turn' src-tauri/src/acp` returns exactly one definition site (the guard).
- Live QA (`bun run qa observe` / `screenshot`): after a terminal error followed by a re-prompt that triggers a permission, the tool call appears in the transcript, not only the Attention Queue.

**Verification:** suites + clippy green; single `preserves_terminal_turn` definition; live screenshot shows the tool row in chat.

---

## Risk Analysis & Mitigation

| Risk | Mitigation |
|---|---|
| Canonical `SessionSnapshot` outputs change during U1 (the guard is not equivalent to today's reducer) | Characterization-first: pin canonical outputs across a representative sequence **before** moving logic; the guard must reproduce them byte-for-byte (U1). |
| Sampling-point bug: terminal event self-suppresses its own row | Decision sampled **pre-apply** via `guard.route`; explicit regression test that a lone `TurnError` still renders the Error row (U2, U3). |
| Live and replay decisions diverge again (the original sin) | One guard implementation + identical decide-then-advance on both seams ⇒ parity by construction; backed by a four-class live-vs-replay parity suite (U4). |
| Unified rule silently flips a `skips_*` expectation and we don't notice | `skips_*` tests are **re-derived** from the unified rule, not blindly kept green; every flipped assertion is a documented, intentional change (U2). |
| **New turn that begins with a non-user event is still suppressed** (the bug in disguise) | The unified rule resets on the first non-suppressed `AgentMessageChunk`/`AgentThoughtChunk`/`ToolCall` of a new turn — but a turn whose literal first event is a suppressed-kind straggler could be mis-gated. Verify against real provider traces whether a new turn can open with a `ToolCall`/agent event and no `UserMessageChunk`; add a falsifying test (see Deferred Questions). |
| Hidden caller of `apply_session_update` missed | Compiler enforces the new required parameter — every call site (prod + test) must be updated to build. |

## Deferred Questions (resolve during U1/U2 implementation)

These were raised by document review as "ship-believing-fixed" traps. Each must be answered against real provider behavior before U5 sign-off; none blocks starting U1, but each needs a test or an explicit "not possible in this provider" note.

- **Non-user new-turn entry:** Can a new turn begin with a `ToolCall` or `AgentMessageChunk` as its literal first event (agent-initiated continuation, resumed session) with no `UserMessageChunk`? If yes, confirm the unified reset fires correctly for it; if it can't (canonical route-skip gating suppresses it), that is the original bug reappearing in a new shape and must be handled.
- **Retry / `attempt_id`:** Does a turn retry emit a fresh `turn_id` (and a `UserMessageChunk`), or reuse the failed turn's `turn_id` with no user chunk? Suppression keys on `turn_id`; the guard is blind to `attempt_id`. Pin the answer with a retry test.
- **Sub-agent / child sessions:** Do child-task events share the parent `session_id` (one guard) or get isolated `session_id`s? If shared, a parent terminal turn could suppress child tool rows. Confirm isolation or scope a follow-up.

## Verification Strategy

The already-written red test (`appends_tool_call_for_new_turn_after_terminal_turn_error`) is the headline behavior proof. Surround it with: U1 canonical-output characterization (guard ≡ old reducer), U2's re-derived `skips_*` suite + the pre-apply Error-row regression test, and U4's four-class live-vs-replay parity suite. Resolve the three Deferred Questions with falsifying tests. Close with live dev-app QA (U5) reproducing the original screenshot scenario.

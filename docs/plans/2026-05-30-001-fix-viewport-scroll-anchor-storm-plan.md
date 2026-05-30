---
title: "fix: Viewport scroll-anchor storm (deterministic scroll authority)"
type: fix
status: completed
created: 2026-05-30
depth: deep
god_gated: true
authority_surface: canonical-transcript-viewport-scroll
---

# fix: Viewport scroll-anchor storm (deterministic scroll authority)

> **Branch context:** `refactor/rust-owned-transcript-viewport`. This plan targets the Rust-owned
> transcript viewport buffer protocol and its frontend consumer. All paths are repo-relative to the
> repository root.

---

## Summary

During fast scrolling into freshly-rendered rows, the transcript viewport exhibits a **scroll storm**:
the view repeatedly yanks in the opposite direction of the user's scroll ("up and down"), and the
scroll spacer resizes ("size changing"). Live measurement reproduces it deterministically — a sustained
upward-scroll drive (60 × −250px) produces ~41 downward jumps and ~61 spacer resizes.

The root cause is a **scroll-authority violation in the Rust buffer producer**: every buffer push —
including user-driven refills and height-confirmation-forced re-pushes — carries an **absolute**
`scroll_top_target` equal to the canonical viewport offset *at request time*. By the time the push is
applied, the user has scrolled further, so the frontend yanks `scrollTop` back to the stale absolute
position. The protocol already documents the correct contract (absolute target only for intentional
repositions; relative `scroll_anchor_correction_px` for geometry compensation) and already carries both
fields — but the producer ignores the contract and the frontend drops the relative correction.

This plan makes the buffer producer honor its own documented contract: emit `scroll_top_target` **only**
for intentional repositions (initial open, reveal, follow-tail) and emit a **relative**
`scroll_anchor_correction_px` for user-driven refills and accepted height confirmations, then wires the
frontend to apply that relative correction additively to the live `scrollTop` instead of dropping it.

**The storm is pre-existing** — measured identically on the pre-flow-layout (absolute-positioning)
render and the current flow-layout render (42/62/66 vs 41/61/61). It is independent of the row-render
strategy and must be fixed at the canonical scroll-authority layer, not in the component.

---

## Problem Frame

**Observed behavior (reproduced live, Tauri-MCP, session 70, ~2,512 rows):**
- Sustained upward scroll → 41 downward `scrollTop` jumps (e.g. +750, +590, +436) fighting the user.
- 61 `totalHeightPx` spacer resizes of ±64–118px during the same window.
- Symptom is worst when scrolling into fresh rows (refill brings new rows → they render → confirm
  height → forced re-push with a stale absolute target → yank).

**Why it happens (root cause, cross-layer):**

1. `viewport.rs::current_offset_px()` is **anchor-based**: for `Detached` mode the canonical scroll
   offset is `anchor_row.offset + offset_from_anchor_px`. When a row above the anchor grows by Δ on an
   accepted height confirmation, `viewport_offset_px` grows by Δ.
2. `runtime_registry.rs` sets `scroll_top_target: Some(slice.viewport_offset_px)` **unconditionally** on
   every `ViewportBufferPush` — the open path (line 1156), the `build_or_advance` FreshPush path
   (line 1308), and the Delta path (line 1326–1327, with `scroll_anchor_correction_px = None`).
3. The **B4 rule** (`runtime_registry.rs` lines 1176–1240) forces a `FreshPush` on **every accepted
   height confirmation**, so the stale absolute target is re-sent constantly during streaming/scrolling.
4. The frontend applies the absolute target once per `emissionSeq`
   (`scene-content-viewport.svelte` lines 487–507). For a user-driven refill the target reflects the
   scroll position *at request time*; the user has since scrolled away, so applying it **yanks** the
   view. Each accepted confirmation also changes `totalHeightPx` → spacer resizes (`overflow-anchor:
   none` means the browser does not compensate) → content shifts.
5. The store **already surfaces** the relative `scrollAnchorCorrectionPx` on `BufferDeltaResult`
   (`transcript-viewport-store.svelte.ts` line 249) but the controller **drops it**
   (`session-store.svelte.ts` line 5195 returns on `status === "applied"` without applying it).

**The contract already exists** (`protocol.rs` lines 150–165):
> `scroll_top_target` … `None` for a pure refill, where the user's current scrollTop is authoritative
> and must be preserved. … Exactly one of `scroll_top_target` (absolute) or
> `scroll_anchor_correction_px` (relative) should be set.

The producer violates this contract. This plan makes it comply.

---

## Scope Boundaries

**In scope:**
- Canonical computation of the relative scroll-anchor correction in the Rust viewport core.
- Rust producer: emit `scroll_top_target` only for intentional repositions; emit
  `scroll_anchor_correction_px` for user-driven refills and accepted height confirmations.
- Add `scroll_anchor_correction_px` to the `ViewportBufferPush` payload (the Delta already has it).
- Frontend: surface the correction on the push projection and apply it additively to the live
  `scrollTop`; stop dropping it on the delta-applied path.

**Out of scope (this plan keeps `overflow-anchor: none` and Rust-authoritative scroll math):**
- Re-architecting the render to top-spacer + in-flow window + bottom-spacer with browser-native
  `overflow-anchor: auto`. This is the considered alternative (see Alternative Approaches) and is
  rejected because the standing mandate is **100% deterministic, byte-optimal** — browser scroll
  anchoring is a heuristic and would risk double-correction against the explicit relative correction.

### Deferred to Follow-Up Work
- **Canonical height accuracy (Bugs #2/#4)** — fresh rows use a 120px estimate vs ~218 real; transient
  too-small confirmed heights (e.g. 56 vs 274). Fixing these shrinks drift and further reduces both
  residual jump magnitude and re-push churn, but the scroll-authority fix in this plan is correct
  regardless of drift (relative correction compensates for whatever drift exists). Tracked by session
  todos `viewport-fresh-row-estimate-calibration` and `viewport-height-confirm-robustness`.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation
> specification. The implementing agent should treat it as context, not code to reproduce.*

### Scroll-authority decision contract (the core fix)

The producer chooses **at most one** of the two scroll fields per emission, driven by the *cause* of the
emission:

| Emission cause | `scroll_top_target` (absolute) | `scroll_anchor_correction_px` (relative) |
|---|---|---|
| Initial open / bootstrap (no prior buffer) | `Some(viewport_offset_px)` | `None` |
| `slice.mode == FollowingTail` (tail-pin) — **regardless of `scroll_intent`** | `Some(bottom)` | `None` |
| `RevealRow` intent | `Some(revealed_row_offset)` | `None` |
| `DetachAtOffset` refill (user-driven scroll), Detached mode | **`None`** (user owns scrollTop) | `Some(Δ_above)` if geometry above shifted, else `None` |
| Accepted height confirmation, **Detached** mode (B4 forced FreshPush) | **`None`** | `Some(Δ_above)` |
| Rejected confirmation / pure streaming append | `None` | `None` |

Where **`Δ_above`** = the signed pixel change, since the previous emission, in canonical offset that
occurs **at or above the current `viewport_offset_px`** — i.e. the amount the *visible* content shifts.
Growth of rows *below* the viewport does not move visible content and contributes `0`.

> **Mode is authoritative, not just intent.** `scroll_intent` is present only on the *transition* into a
> mode. Once the viewport is in `FollowingTail` mode, subsequent B4 confirmation pushes arrive with
> `scroll_intent = None` while `slice.mode == FollowingTail`. The producer MUST classify on
> `slice.mode` (FollowingTail wins → absolute tail target, never a relative correction); only `Detached`
> mode uses the relative-correction branch. Classifying on `scroll_intent` alone would emit a spurious
> relative correction on every streaming confirmation that then races the frontend tail-pin.

### Why relative, not absolute, is race-free

```
user scrolls up continuously:   scrollTop:  X ──▶ X-250 ──▶ X-500 ──▶ ...
                                                 (refill requested at X-250)
absolute target (today):  apply target=X-250  ▶ YANK back +250 against the user   ✗
relative correction:      apply +Δ_above       ▶ scrollTop += Δ_above (≈0 here)    ✓
                                                  no dependence on a stale absolute position
```

A relative correction is applied to **whatever `scrollTop` currently is**, so it never fights the live
scroll position. It only compensates for canonical geometry that shifted above the viewport.

### Data path

```
viewport.rs confirm_height (accepted)
   └─ compute Δ_above (offset shift at/above viewport)        [U1, canonical]
        │
runtime_registry.rs build_or_advance / build_push
   └─ pick scroll_top_target XOR scroll_anchor_correction_px  [U2, producer authority]
        │  (ViewportBufferPush gains scroll_anchor_correction_px)
        ▼
protocol.rs ViewportBufferPush / ViewportBufferDelta  ──specta──▶ acp-types.ts
        │
transcript-viewport-store.svelte.ts
   └─ BufferProjection surfaces scrollAnchorCorrectionPx        [U3]
        ▼
session-store.svelte.ts applyBufferDelta — stop dropping it     [U4]
scene-content-viewport.svelte
   └─ $effect: scrollTop += correction (additive, suppress-guarded)   [U4]
   └─ existing absolute-target $effect now fires ONLY for repositions
```

---

## Key Technical Decisions

1. **Relative correction is computed canonically in Rust, not the frontend.** The shift amount is a
   function of canonical layout geometry (which rows grew, where they sit relative to the viewport
   offset). Per GOD, the frontend must consume this fact, not recompute it. (Decision: extend
   `confirm_height` / the viewport to expose `Δ_above`.)

2. **`scroll_top_target` and `scroll_anchor_correction_px` are mutually exclusive per emission.** The
   protocol already documents this (`protocol.rs` line 164–165). The producer enforces it; the frontend
   applies absolute target in one effect and relative correction in another, each keyed on `emissionSeq`
   so each applies exactly once and they never both fire for the same emission.

3. **Emission cause is classified on `slice.mode` first, then `scroll_intent`.** `FollowingTail` mode
   always emits the absolute tail target (never a relative correction), because once streaming is in
   follow-tail the B4 confirmation pushes carry `scroll_intent = None` and the absolute tail target
   already incorporates the post-confirmation `total_height_px`. Only `Detached` mode takes the
   relative-correction branch. (Critique finding — classifying on intent alone would emit a spurious
   correction on every streaming confirmation that races the frontend tail-pin.)

4. **Keep `overflow-anchor: none`; do not rely on browser anchoring.** The standing mandate is
   deterministic and byte-optimal. Explicit Rust-authored relative correction is fully deterministic;
   browser-native anchoring is a heuristic and would double-correct against the explicit correction.

5. **`Δ_above` only counts geometry at or above the viewport offset.** Below-viewport growth does not
   move visible content, so emitting a correction for it would itself cause a spurious jump. The
   computation must be viewport-relative (the pre/post `current_offset_px()` diff), not a raw
   total-height delta.

6. **Relative corrections must accumulate across coalesced emissions.** Svelte batches `$state` updates,
   so a rapid burst of B4 confirmation pushes can collapse into a single projection flush. A single
   `emissionSeq`-latched effect would apply only the last Δ and silently drop the intermediate ones,
   leaving residual drift. The frontend therefore tracks a running **sum** of unapplied corrections
   (across every emission newer than `lastAppliedCorrectionEmissionSeq`), applies the sum once, and
   advances the latch to the newest emission. (Critique finding — required for the zero-residual-drift,
   deterministic goal.)

7. **The B4 forced-FreshPush stays.** It is required for offset correctness (re-sending shifted offsets).
   The fix is not to remove it but to make the FreshPush it produces carry `scroll_top_target = None` +
   `scroll_anchor_correction_px = Some(Δ_above)` instead of a stale absolute target.

---

## Implementation Units

### U1. Canonical relative scroll-anchor correction in the viewport core

**Goal:** Make the Rust viewport compute, on an accepted height confirmation (and any layout mutation
that shifts offsets above the current viewport), the signed pixel correction `Δ_above` that the consumer
must add to `scrollTop` to keep the visible content stable.

**Requirements:** Addresses the stability half of the storm (the "size changing" / content-shift
symptom). Foundation for U2.

**Dependencies:** none.

**Files:**
- `packages/desktop/src-tauri/src/acp/transcript_viewport/viewport.rs`
- `packages/desktop/src-tauri/src/acp/transcript_viewport/layout.rs` (if the per-row offset delta is
  most cleanly sourced from the layout index)

**Approach:**
- Capture the pre-confirmation `viewport_offset_px` and the confirmed row's pre/post offset, and derive
  `Δ_above` = the change in `viewport_offset_px` attributable to height changes at indices whose offset
  is `< viewport_offset_px`. For a single accepted confirmation of a row above the viewport this equals
  the row's height delta; for a row at/below the viewport it is `0`.
- Expose it without breaking the existing `current_offset_px` anchor semantics — e.g. enrich
  `HeightConfirmationOutcome::Accepted` with `anchor_correction_px: i64`, or add a viewport accessor
  that the producer reads alongside the slice. Prefer the outcome-carried value so it is computed
  exactly once, at the moment the confirmation is applied.
- Rejected confirmations contribute `0` (no layout change), consistent with the existing
  `viewport_revision` guard.

**Patterns to follow:** mirror the existing `confirm_height` → `HeightConfirmationOutcome` flow and the
`viewport_revision` bump discipline (only on `Accepted`).

**Test scenarios** (`viewport.rs` / `layout.rs` `#[cfg(test)]`, run via `cargo test --lib`):
- Accepted confirmation of a row **above** the current viewport offset grows by Δ → correction `== +Δ`.
- Accepted confirmation of a row **below** the viewport offset → correction `== 0`.
- Accepted confirmation that **shrinks** an above-viewport row by Δ → correction `== −Δ`.
- Rejected (stale-version) confirmation → correction `== 0` and `viewport_revision` unchanged.
- `Detached` mode, anchor row itself grows → `Δ_above` reflects the resulting `current_offset_px()` diff
  (pre/post), confirming the computation tracks the anchor-based offset exactly.

> The previous draft's "FollowingTail mode, confirmation below the tail → 0" scenario is
> **geometrically impossible** (in FollowingTail the tail *is* the last row; there are no rows below the
> viewport offset) and would pass vacuously. FollowingTail behavior is instead covered by the
> integration test in U2 (mode → absolute tail target, never a correction).

**Verification:** new unit tests pass; existing `viewport.rs` tests remain green; correction sign
convention documented in a doc-comment.

### U2. Producer emits target XOR correction per emission cause

**Goal:** Replace the unconditional absolute `scroll_top_target` with the decision contract: absolute
target only for intentional repositions; relative `Δ_above` (from U1) for user-driven refills and
accepted confirmations. Add `scroll_anchor_correction_px` to the push payload.

**Requirements:** This is the core scroll-authority fix — eliminates the stale-absolute yank.

**Dependencies:** U1.

**Files:**
- `packages/desktop/src-tauri/src/acp/session_state_engine/protocol.rs` (add
  `scroll_anchor_correction_px: Option<i64>` to `ViewportBufferPush`; keep the mutual-exclusion
  doc-comment; update the `ViewportBufferPush` test fixture at line ~294)
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` (both push construction
  sites at lines 1156 and 1283–1311, and the delta path at lines 1313–1329)
- `packages/desktop/src-tauri/src/acp/session_state_engine/envelope.rs` (if it re-exports/relays the
  field)
- `packages/desktop/src/lib/services/acp-types.ts` (specta-generated — regenerate, do not hand-edit
  beyond what the generator emits)

**Approach:**
- Derive an `EmissionCause` from the producer inputs already in scope, classifying on **`slice.mode`
  first, then `scroll_intent`**: `slice.mode == FollowingTail`, `scroll_intent`
  (`FollowTail` / `RevealRow` / `DetachAtOffset`), `height_confirmation` presence + accepted-ness
  (`height_accepted` already computed at line 1237), and whether a prior buffer existed (`prev`,
  bootstrap detection) / `force_fresh`.
- Map cause → fields per the contract table:
  - `FollowingTail` mode (any cause, including B4 confirmation with `scroll_intent = None`) →
    `scroll_top_target = Some(bottom)`, `scroll_anchor_correction_px = None`. **FollowingTail wins over
    the B4 correction branch** — the absolute tail target already incorporates post-confirmation
    `total_height_px`.
  - intentional reposition (bootstrap, `RevealRow`) → `scroll_top_target = Some(...)`,
    `scroll_anchor_correction_px = None`.
  - `Detached` mode user-driven `DetachAtOffset` refill and `Detached` accepted-confirmation FreshPush →
    `scroll_top_target = None`, `scroll_anchor_correction_px = Some(Δ_above)` (`None`/omit when `Δ == 0`).
- Apply the same mapping to the Delta path (replace the hardcoded `None, Some(viewport_offset_px)` at
  lines 1326–1327).
- Enforce the invariant in a small helper so both push and delta paths share one decision function;
  debug-assert never-both-Some.

**Patterns to follow:** the existing `height_accepted` computation (line 1237) and the B4 comment block;
keep the lock-order and `emission_seq` discipline untouched.

**Test scenarios** (`runtime_registry.rs` `#[cfg(test)]`):
- `DetachAtOffset` refill push → `scroll_top_target == None`.
- `FollowTail` push → `scroll_top_target == Some(bottom)`, correction `None`.
- `RevealRow` push → `scroll_top_target == Some(revealed_offset)`, correction `None`.
- Bootstrap (no `prev`) → `scroll_top_target == Some(viewport_offset_px)`.
- **`FollowingTail` mode + accepted height confirmation with `scroll_intent = None`** (the dominant
  streaming case) → `scroll_top_target == Some(bottom)`, `scroll_anchor_correction_px == None`. This is
  the integration test that replaces the impossible U1 FollowingTail scenario: viewport in FollowingTail,
  a row at index N grows, assert the push targets `total_height_px − viewport_height_px` and carries no
  correction.
- `Detached` accepted height confirmation with an above-viewport row growth (B4 FreshPush) →
  `scroll_top_target == None`, `scroll_anchor_correction_px == Some(Δ)`.
- `Detached` accepted confirmation with only below-viewport growth → both `None` (no spurious correction).
- Delta path under user scroll (Detached) → `scroll_top_target == None`, correction reflects `Δ_above`.
- Invariant: no emission sets both fields to `Some` (assert across all the above).
- Update the existing assertion at line ~4406 (`delta.scroll_top_target == Some(400)`) to the new
  contract.

**Verification:** `cargo test --lib` green; `cargo clippy` clean; specta types regenerate with the new
field present in `acp-types.ts`.

### U3. Surface the relative correction on the frontend push projection

**Goal:** Carry `scrollAnchorCorrectionPx` through the store's `BufferProjection` (push path), matching
what `BufferDeltaResult` already exposes for the delta path.

**Requirements:** Wires U2's new field to the consumer.

**Dependencies:** U2.

**Files:**
- `packages/desktop/src/lib/acp/store/transcript-viewport-store.svelte.ts` (add
  `scrollAnchorCorrectionPx: number | null` to `BufferProjection`; populate from `push` at line ~101
  and preserve/clear it across `applyBufferDelta` projection updates at line ~162)
- `packages/desktop/src/lib/acp/store/__tests__/transcript-viewport-store.vitest.ts`

**Approach:**
- Add the field to the projection type and set it from `push.scrollAnchorCorrectionPx ?? null` on
  `applyBufferPush`. On `applyBufferDelta`, the projection's correction should reflect the delta's
  correction for that emission (so the controller reads a per-emission value keyed on `emissionSeq`).
- **Coalescing-safe accounting:** because Svelte batches `$state` updates, multiple pushes can land in
  one flush. To prevent intermediate corrections being dropped, the projection must let the controller
  recover *all* unapplied corrections — either by exposing the per-emission correction alongside a
  monotonic `emissionSeq` (the controller sums everything newer than its latch), or by the store
  maintaining a running `pendingScrollCorrectionPx` accumulator that the controller drains. Prefer the
  accumulator: store sums each emission's correction into `pendingScrollCorrectionPx`; the controller
  applies and zeroes it. The store still never touches `scrollTop`.
- Do not have the store touch `scrollTop` — it stays a pure projector (existing invariant).

**Test scenarios** (vitest):
- `applyBufferPush` with `scrollAnchorCorrectionPx: 40` → projection/accumulator exposes `40`.
- `applyBufferPush` with the field absent/null → no change to the accumulator.
- After `applyBufferDelta` carrying a correction → the correction is recoverable for the new
  `emissionSeq`.
- **Coalescing:** three successive pushes carrying corrections `+30, +50, +20` within one batch →
  the controller can recover the **sum `+100`**, not just the last `+20` (the regression this guards).

**Verification:** `AGENT=1 bun test transcript-viewport-store` green; `bun run check` clean.

### U4. Apply the relative correction to live scrollTop; stop dropping it

**Goal:** The viewport controller applies `scrollAnchorCorrectionPx` additively to the live `scrollTop`
(guarded against echoing a scroll intent), and the absolute `scroll_top_target` effect now fires only
for intentional repositions (automatic, since U2 sends `None` otherwise). Stop discarding the correction
on the delta-applied path.

**Requirements:** Completes the fix end-to-end — the storm stops.

**Dependencies:** U3.

**Files:**
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts` (line ~5193–5198: on
  `status === "applied"`, propagate `scrollAnchorCorrectionPx` instead of returning and dropping it —
  surface it so the component can apply it; keep `scrollTop` ownership in the component, not the store)
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` (add a
  new `$effect` keyed on `emissionSeq` that applies the correction additively; leave the absolute-target
  effect at lines 487–507 unchanged)

**Approach:**
- New effect: when there is an unapplied accumulated correction (`pendingScrollCorrectionPx != 0`, or
  the projection's correction `emissionSeq` is newer than `lastAppliedCorrectionEmissionSeq`), after
  `tick()` set `scrollContainerRef.scrollTop += accumulatedCorrection`, then zero the accumulator /
  advance the latch to the newest emission, with `suppressNextScrollIntent = true` so the programmatic
  adjustment does not echo a (non-canonical) scroll intent back to Rust.
- **Apply the sum, not the last value.** Because a B4 streaming burst can collapse into one Svelte
  flush, the effect must apply the *accumulated* correction across every emission since the last apply
  (see U3), or intermediate Δs are lost and the view drifts.
- **Order after layout commit.** The correction must be applied *after* the new `offsetsPx` /
  `totalHeightPx` (which change `windowTopPx` and spacer height) are committed to the DOM. `tick()`
  flushes pending Svelte DOM updates, so reading/writing `scrollTop` inside `void tick().then(...)`
  runs after the spacer/`windowTopPx` reactive writes — matching the existing absolute-target and
  tail-pin effects.
- Because correction is additive and small, it never fights the live scroll position (unlike the
  absolute target). The absolute-target effect remains for the reposition cases only.
- For the delta path: the simplest GOD-clean wiring is to let the correction ride on the projection /
  accumulator (U3) so the *same* component effect handles both push- and delta-sourced corrections; then
  `session-store.svelte.ts` only needs to stop early-returning in a way that discards it. Confirm the
  delta-updated projection contributes its correction to the accumulator (U3) so no separate callback is
  needed.

**Execution note:** Start with a failing integration/characterization test that drives a sequence of
pushes simulating "user scrolled away before the stale target applied" and asserts the controller does
**not** yank `scrollTop` to an absolute position on a refill push (`scroll_top_target == null`), and
**does** add the correction on a confirmation push.

**Patterns to follow:** the existing absolute-target `$effect` (lines 487–507) and the
`suppressNextScrollIntent` guard already used by the follow-tail pin (lines 512–536) and `handleScroll`.

**Test scenarios:**
- (vitest/component) Refill push with `scrollTopTarget == null`, no correction →
  `scrollTop` unchanged (no yank).
- Confirmation push with `scrollTopTarget == null`, correction `40` → `scrollTop`
  increases by exactly 40; `suppressNextScrollIntent` was set (no intent echo).
- **Coalesced burst:** three confirmation pushes (`+30, +50, +20`) in one flush → `scrollTop` increases
  by exactly `100` (sum), not `20` (last).
- Reposition push with `scrollTopTarget == 200`, no correction → absolute target applied once
  (existing behavior preserved).
- FollowingTail confirmation push (`scrollTopTarget == Some(bottom)`, no correction) → tail-pin path
  owns position; correction effect does not fire.
- Each effect applies exactly once per emission window (no double-apply when both effects re-run).
- `session-store.svelte.ts` delta-applied path no longer discards a non-null correction.

**Verification:** `bun run check` clean; component tests green.

### U5. End-to-end deterministic storm regression guard + live validation

**Goal:** Lock in the fix with a deterministic regression test at the producer→consumer seam, and
validate live that the storm is gone.

**Requirements:** Prevents regression; proves the user-visible symptom is resolved.

**Dependencies:** U4.

**Files:**
- `packages/desktop/src/lib/acp/store/__tests__/transcript-viewport-store.vitest.ts` (or a new
  focused spec) — a simulated emission sequence asserting the contract holds across a scroll+confirm
  burst.

**Approach:**
- Construct a deterministic sequence: initial push (target Some) → `DetachAtOffset` refill (target None)
  → several accepted-confirmation FreshPushes (target None, correction Some). Assert that applying them
  through the store/projection never yields a `scrollTopTarget` on a non-reposition emission and that
  corrections are the only scroll signal.
- Live validation (Tauri-MCP): re-run the sustained-upward-scroll probe (60 × −250px) and assert
  downward jumps drop from ~41 to ~0 and spacer-resize-driven content shifts are compensated. Record the
  before/after numbers in the PR.

**Execution note:** This is the red→green proof for the whole plan — write the deterministic sequence
test to fail against `main` (absolute target on refill) and pass after U2/U4.

**Test scenarios:**
- Deterministic emission-sequence test as above (the regression guard).
- Live probe: downward jumps ≈ 0 under sustained scroll (manual/QA evidence, not a unit test).

**Verification:** new regression test green; live probe shows ≈0 downward jumps; no overlap/gap
regression (re-run the existing 0-overlap probe from the shipped flow-layout fix).

---

## System-Wide Impact

- **Rust producer (`runtime_registry.rs`)** — the scroll-field decision changes for every buffer
  emission. The B4 forced-FreshPush and `emission_seq`/lock discipline are unchanged; only the two
  scroll fields change. Risk surface: the open path, the `build_or_advance` FreshPush path, and the
  Delta path must all use the shared decision helper to stay consistent.
- **Protocol (`protocol.rs`) + generated types (`acp-types.ts`)** — additive field on
  `ViewportBufferPush`; backward-compatible (`skip_serializing_if = "Option::is_none"`). Snapshot/budget
  tests that assert envelope shape may need updating
  (`session-state-envelope-budget.test.ts`, `session-state-command-router.test.ts`).
- **Frontend store + controller** — the store gains a projection field; the controller gains one effect
  and stops dropping the correction. `scrollTop` ownership stays in the component (GOD-clean).
- **Follow-tail and reveal flows** — must be re-validated: they rely on the absolute target, which is
  preserved for exactly those causes. U2/U5 tests cover them explicitly.

---

## Alternative Approaches Considered

**Option B — browser-native anchoring (top-spacer + in-flow window + bottom-spacer, `overflow-anchor:
auto`).** Restructure the render so the buffered window is in-flow between two spacers and let the
browser keep visually-anchored content stable when heights above change; the producer would then only
ever send `scroll_top_target` for repositions and emit no per-confirmation correction at all.
*Rejected* because (a) the standing mandate is 100% deterministic / byte-optimal and browser scroll
anchoring is a heuristic that varies across engine versions; (b) it would risk double-correction if any
explicit correction remained; (c) absolutely-positioned elements are not anchor candidates, so it forces
a larger render restructure than the scroll-authority fix needs. Option A (this plan) keeps scroll math
canonical and deterministic in Rust.

**Option C — minimal: set `scroll_top_target = None` on refills/confirmations and emit no correction.**
This stops the yank but leaves visible content jumping whenever a row above the viewport finalizes its
height (the "size changing" symptom persists on scroll-up). *Rejected* as a partial fix — the relative
correction is needed for stability, and the protocol already reserves the field for exactly this.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `Δ_above` mis-signed → content drifts the wrong way | Med | High | U1 unit tests pin sign convention (grow-above `+`, shrink-above `−`, below `0`); live probe validates |
| Double-apply of absolute target + correction in same emission | Low | High | Mutual-exclusion invariant enforced in producer helper + debug-assert; separate `emissionSeq` latches per effect (U4) |
| **FollowingTail B4 confirmation misclassified (intent=None) → spurious correction races tail-pin** | **Med** | **High** | **Classify on `slice.mode` first (FollowingTail → absolute target); explicit U2 integration test** |
| **Coalesced B4 burst drops intermediate corrections → residual drift** | **Med** | **Med** | **Accumulate the correction sum across unapplied emissions (U3/U4); coalescing test asserts sum** |
| Follow-tail / reveal regress because target was removed too broadly | Med | High | Target preserved for exactly those causes; explicit U2 + U5 tests |
| Correction echoes a scroll intent → feedback loop | Low | Med | `suppressNextScrollIntent` guard (U4), mirroring the follow-tail pin |
| Below-viewport growth emits a spurious correction → new jump | Med | Med | U1 computes viewport-relative `Δ_above` (below-viewport = 0); U2 test asserts both-`None` |
| Correction applied before layout commit → races spacer/windowTopPx | Low | Med | Apply inside `void tick().then(...)` after DOM flush (U4), matching existing effects |
| Envelope budget/snapshot tests break on the new field | High | Low | Update `session-state-envelope-budget.test.ts` / router tests as part of U2 |

---

## Verification Strategy

- **Rust:** `cd packages/desktop/src-tauri && cargo test --lib` (U1, U2) + `cargo clippy`.
- **Frontend:** `cd packages/desktop && bun run check` + `AGENT=1 bun test transcript-viewport-store`
  (U3, U5) + component tests (U4).
- **End-to-end (deterministic):** U5 emission-sequence regression test (red on `main`, green after fix).
- **Live QA (Tauri-MCP):** sustained-upward-scroll probe shows downward jumps ≈ 0 (from ~41); re-run the
  existing 0-overlap probe to confirm no overlap/gap regression. Record before/after in the PR.

---

## Requirements Traceability

| Requirement (from problem frame) | Units | Verification |
|---|---|---|
| No scroll yank against user during fast scroll/refill | U2, U4 | U2 refill→target None; U4 no-yank test; live probe ≈0 jumps |
| Visible content stable when heights above finalize | U1, U2, U3, U4 | U1 `Δ_above`; U4 additive-correction test; live probe |
| Intentional repositions (open/reveal/follow-tail) still work | U2 | U2 target-Some tests for each cause |
| Canonical scroll authority preserved (GOD) | U1, U2 | correction computed in Rust; FE consumes only |
| Deterministic, no browser-heuristic dependence | (design) | `overflow-anchor: none` kept; Option B rejected |

---
title: "refactor: Rust-pushed viewport layout index with local-resolution scrolling"
type: refactor
status: active
depth: deep
created: 2026-05-29
origin: none (solo architectural exploration — "GOD-level viewport architecture" reflection)
related_plan: docs/plans/2026-05-28-001-refactor-rust-owned-transcript-viewport-plan.md
---

# refactor: Rust-pushed viewport layout index with local-resolution scrolling

## Summary

The transcript viewport migration moved row identity, order, layout, and follow-tail into Rust and deleted TanStack. It works and is canonically correct (Level-3 deterministic), but it left one structural property unfinished: **every scroll frame is a query-before-paint round trip**. The WebView holds offsets only for the currently-visible rows, so it cannot place any row at a new scroll position without an IPC. Measured on session 70 (~275,000px transcript): ~36fps avg, p95 91ms, max 141ms, 91% of frames miss the 8.33ms budget. The system also re-sends a full ~4.6KB window per scroll (overlapping the previous frame ~90%) and retains a TypeScript display-entry reconstruction fallback that violates the migration's own no-WebView-reconstruction rule.

This plan completes the migration's intent (R10 delta-oriented hot updates, R11 intent-level scroll, R14 bounded overscan) by changing the viewport protocol from **answer-per-scroll** to **push-a-working-set**: Rust pushes a buffered slice of its already-authoritative `LayoutIndex` plus its rows; the WebView resolves any in-buffer scroll offset locally and synchronously at 120fps; scroll becomes an async, coalesced *intent* that slides the buffer and drives follow/detach; refills arrive as deltas at a high-water mark. Rust stays the single source of truth — the WebView never invents identity, order, or height; it only resolves pixel positions from canonical numbers Rust pushed.

This is **not a rewrite** and **not a move to Canvas**. The DOM stays for accessibility, in-viewport text selection, and in-viewport native Find. (Caveat, corrected from an earlier draft: native Cmd+F matches only *materialized* rows, so full-transcript find across non-materialized rows is a separate app-level search feature — deferred, not delivered by keeping the DOM.) The Rust `LayoutIndex` already exists and is authoritative; the work is to push a buffer of it, resolve locally, send deltas, make the index update O(log N), and delete the reconstruction fallback.

---

## Problem Frame

**Authority surface (GOD):** canonical transcript viewport (Rust-owned). The canonical model is correct; this plan does not move truth into the WebView. It changes *how much* canonical data is pushed ahead of need and *where* pixel-offset resolution happens, while keeping semantic position (which rows, what order, what height) Rust-owned.

**Three independent defects against the completed migration:**

1. **Query-before-paint latency floor (structural).** The WebView must IPC before it can paint a novel scroll offset. No transport speed fixes this; an IPC (3–11ms) exceeds the 120fps frame budget (8.33ms). This is why 120fps is currently architecturally impossible, not merely unoptimized.
2. **Not byte-optimal (violates R10).** There is no viewport-delta type (`grep` confirms: only `VisibleTranscriptWindowPayload`, a full window). Each scroll re-sends a full window whose rows ~90% overlap the prior frame. R13 (bounded payload) is met; R10 (delta-oriented hot updates) was never realized for the viewport.
3. **Residual WebView reconstruction (violates R3/R4).** `resolveSceneEntry` in `scene-content-viewport.svelte` *builds* a display entry when a row is missing from the scene map — exactly the display reconstruction the migration meant to delete.

**Determinism clarification.** "100% deterministic" for this product means Level 3 (Rust owns which rows exist, their order, identity, and confirmed heights; no WebView invention or repair). DOM achieves L3 and L2 (session-stable heights via height-confirm). L1 (cross-platform pixel-exact) is impossible with DOM text shaping and is explicitly **not** a requirement — so Canvas/GPUI is out of scope (recorded under Alternatives as the L1 north star only).

**What this plan is NOT:** not a Canvas/WebGL/GPUI renderer; not a change to row identity, transcript order, or operation/interaction graphs; not a coexistence layer (the full-window command path is replaced, not kept alongside).

---

## Goal / Success Criteria

- **Performance:** session-70 rAF scroll benchmark reaches sustained 120fps for any scroll landing **within the pushed buffer** — zero IPC on the paint path, p95 frame time ≤ 8.33ms (from 91ms baseline). Out-of-buffer flings degrade gracefully (brief skeleton, not jank storm), with buffer sized so normal reading and typical flings never leave it.
  - **Verifiable acceptance gates (resolves "120fps is unmeasurable on 60Hz dev hardware"):** the load-bearing, hardware-independent gates are (1) **zero `invoke` on the in-buffer paint path** — asserted structurally by an IPC-count test/instrumentation over a scripted in-buffer scroll, and (2) **p95 frame compute ≤ 8.33ms** measured via `performance.now()` deltas around the rAF scroll handler in the existing benchmark (compute time, independent of the monitor's actual refresh cap). "120fps" is the architectural target; these two gates are what CI/QA actually verifies.
- **Byte-optimality:** steady-state scrolling within the buffer sends **zero** layout bytes; buffer refills send **deltas** (appended/removed rows + offset corrections), not full windows. Eliminate the full-window-per-scroll payload.
- **Purity (GOD):** delete `resolveSceneEntry`'s reconstruction branch; the WebView renders only rows Rust supplies. No `canonical ?? hotState`, no display-entry construction in TypeScript. **This criterion is met only when U5 lands** — if U5 is scheduling-blocked by the concurrent scene-mapper work, the plan is incomplete, not done (see Assumptions 4).
- **Correctness (no regressions):** follow-tail stays pinned during rapid streaming; height corrections for off-screen rows do not jump content under the user's finger; detach/reattach transitions remain Rust-acknowledged.
- **Scalability:** `LayoutIndex` height-confirmation and offset queries are O(log N) (Fenwick tree), verified to not regress at 100k rows.
- **Verification gates:** `cargo test --lib` green; `bun run check` exit 0 incl. both guard scripts (`check:transcript-virtualizer`, `check:rust-owned-transcript-viewport`); live Tauri MCP QA on session 70 shows smooth scroll + clean console.

---

## Requirements Traceability

| ID | Requirement | Origin |
|----|-------------|--------|
| R-A | WebView resolves any in-buffer scroll offset locally, with zero IPC on the paint path | This plan; completes migration R11 (intent-level scroll) |
| R-B | Rust pushes a bounded buffer (rows + compact cumulative-height layout index) sized to cover normal reading and typical flings | Completes migration R14 (bounded overscan from Rust) |
| R-C | Buffer refills are deltas (appended/removed rows + offset corrections), never full windows | Completes migration R10 (delta-oriented hot updates) |
| R-D | Height corrections include `scrollAnchorCorrectionPx` applied atomically with the offset so off-screen corrections never jump visible content | This plan (rubber-duck blocking finding) |
| R-E | Follow-tail pushes include an explicit `scrollTopTarget` the WebView applies whenever the Rust-acknowledged mode is `followingTail` | This plan (rubber-duck blocking finding) |
| R-F | `LayoutIndex` offset/height operations are O(log N) via Fenwick tree | This plan (rubber-duck scalability finding) |
| R-G | Delete the entry-building (build-on-miss) branch in `resolveSceneEntry` and replace it with a hard invariant; the WebView renders only rows Rust supplies (the happy-path canonical lookup stays) | Migration R3/R4 (no WebView reconstruction) |
| R-H | Scroll is an async, coalesced intent; render mode (follow/detach) changes only on Rust acknowledgment | Migration R11; GOD single-authority |
| R-I | Scroll container uses `overflow-anchor: none` so browser scroll-anchoring does not fight absolute-offset correction | This plan (rubber-duck finding) |
| ~~R-J~~ | **Deferred** — virtualized-row accessibility (setsize/posinset + roles, keyboard traversal, focus retention across buffer eviction, full-transcript find) | Split into its own follow-up plan; see Scope Boundaries → Deferred |
| R-K | The full-window path (`VisibleTranscriptWindowPayload`) is fully removed once the buffer push/delta path is verified; no parallel authority paths remain | GOD (no dual authority); completes migration |
| R-L | Deltas are exact-chained (`fromViewportRevision === store revision`); any gap triggers an explicit full-push resync so the protocol stays idempotent/self-healing | This plan (adversarial P0 finding) |

---

## Key Technical Decisions

1. **Push a buffer, resolve locally.** Rust pushes a contiguous slice of `LayoutIndex` (rows + their absolute `offsetPx` + `totalHeightPx`) covering a generous buffer around the viewport. The WebView, given a scroll offset within `[bufferStartPx, bufferEndPx]`, picks visible rows and positions them with no IPC. Rationale: removes the query-before-paint floor while keeping Rust the owner of every number the WebView reads. *(directional, not the wire format spec)*

2. **Buffer size = ~5× viewport height, refill at ≥40% remaining runway.** At ~50,000px/s flings and ~11ms cold IPC, ~550px of runway is consumed before a refill lands; 5× viewport with an early high-water mark keeps the buffer ahead of the user. The exact constant is tunable; the protocol must not assume a fixed value.

3. **Scroll = async coalesced intent (keep + extend the existing rAF coalescing already applied in `scene-content-viewport.svelte`).** The WebView emits at most one intent per frame, reading `scrollTop` at fire time. The intent slides the buffer and updates follow/detach; it is never on the paint path.

4. **Optimistic semantic prediction for detach.** The WebView may compute the follow/detach threshold locally from the pushed index and emit an intent at pixel speed, but only flips render mode on Rust's acknowledged `mode`. Avoids dual-authority while staying responsive. **`scrollTopTarget` is applied only when the Rust-acknowledged mode is `followingTail` — never the locally predicted mode** — so a follow push arriving while a detach intent is in flight does not fight the user's scroll. The local prediction gates only whether to *emit* an intent; it never gates application of an incoming push. **Resize-invariant tail pin (resolves the resize-while-streaming stale-height race):** while in acknowledged `followingTail` mode the WebView pins to bottom *locally* via `scrollTop = scrollHeight - clientHeight` using the live `clientHeight`, treating `scrollTopTarget` only as the initial/fallback value. "Pin to bottom" is invariant under viewport resize, so a `scrollTopTarget` computed by Rust against a stale viewport height is never the source of truth during a resize.

5. **Two new protocol fields are mandatory, not optional.** `scrollAnchorCorrectionPx` (on height-correction pushes, applied atomically with the new offset) and `scrollTopTarget` (on follow-tail pushes, applied whenever the Rust-acknowledged mode is `followingTail` — see Decision 4). Without these the system ships visible artifacts (content jump on first measure; tail lag during streaming).
   - **Anchor definition (resolves the "anchor is undefined" gap):** the *anchor* is the top fully-visible row at the moment a height-confirm intent is emitted. The WebView includes `anchorRowId` and its current `scrollTop` in the confirm/scroll intent. Rust computes `scrollAnchorCorrectionPx = Σ (confirmedHeightDelta of every row with index < anchorIndex) since the prior push` — i.e., the pixel shift accumulated *above* the anchor. The WebView applies `scrollTop += scrollAnchorCorrectionPx` atomically with the offset update so the anchor row stays under the user's eye. In `followingTail` mode there is no anchor correction (the tail pin in Decision 4 governs); in `detached` mode the anchor is always the top fully-visible row.

6. **Fenwick tree (BIT) inside `LayoutIndex`.** Replace `rebuild_offsets_only`'s O(N) `Vec<u64>` rebuild with an O(log N) Fenwick update on `confirm_height`; the pushed snapshot stays a flat array (cheap to materialize for the buffer slice). Decide now — retrofitting the index structure later is a breaking internal change.

7. **Delete reconstruction, do not memoize it.** The fix for `resolveSceneEntry` is upstream completeness (Rust/scene mapper always supplies the row for any pushed buffer row), not caching the reconstruction. The scene mapper (`desktop-agent-panel-scene.ts`) is co-owned with a concurrent agent — coordinate before editing; if blocked, this unit defers without blocking the rest.

8. **`overflow-anchor: none` on the scroll container.** Required so the browser's native scroll-anchoring does not double-correct against the absolute-positioned offset corrections.

9. **Deltas are exact-chained with explicit resync (not snapshot-ordering).** A `ViewportBufferDelta` carries `fromViewportRevision`/`toViewportRevision`. The WebView applies it **iff `fromViewportRevision === store.currentRevision` (exact equality)** — NOT the `>` predicate used by `isNewerVisibleWindow` for independent full snapshots. Using `>` would apply a delta against the wrong baseline and silently corrupt the buffer (rows spliced against stale state), invisible until the next full push. On any mismatch or IPC error (a gap), the WebView emits a `requestFullPush` intent carrying its current revision; Rust replies with a fresh `ViewportBufferPush` that **resets** the store revision regardless of staleness. This restores the idempotent, self-healing property the full-window path had for free, reusing the resync-on-stale-revision behavior already added in U3. A full snapshot (`ViewportBufferPush`) still uses newer-wins ordering; only chained deltas use exact equality.

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Today (query-before-paint):**

```
scroll event ──► dispatchScrollIntent ──► invoke(acp_scroll_...) ──► Rust builds FULL window ──► returns ──► paint
                                          (3–11ms, blocks paint; full ~4.6KB every frame)
```

**Target (push-a-working-set):**

```
                 ┌──────────────────────── Rust (authority) ─────────────────────────┐
                 │  LayoutIndex (Fenwick)  ── buffer slice ──►  ViewportBufferPush     │
                 │  TranscriptViewport      (rows + offsets + totalHeight + mode +     │
                 │                            scrollTopTarget? + anchorCorrection?)    │
                 └───────────────▲───────────────────────────────────┬────────────────┘
   async coalesced intent        │                                   │ push (snapshot once, then deltas)
   (slide buffer, follow/detach) │                                   ▼
                 ┌───────────────┴───────────────── WebView (dumb) ───────────────────┐
                 │  holds buffer [startPx..endPx]                                       │
                 │  scroll ──► resolve visible rows from local index ──► paint  (0 IPC) │
                 │  crosses high-water mark ──► emit refill intent                      │
                 │  receives delta ──► splice buffer, apply anchorCorrection atomically │
                 └─────────────────────────────────────────────────────────────────────┘
```

**Delta shape (directional):** `ViewportBufferDelta { fromViewportRevision, toViewportRevision, prependedRows[], appendedRows[], removedRowIds[], totalHeightPx, scrollAnchorCorrectionPx?, scrollTopTarget? }` — additive to the existing `SessionStatePayload` union, parallel to `assistantTextDelta`.

---

## Implementation Units

### U1. Fenwick-backed LayoutIndex (O(log N) offsets)

**Goal:** Replace the O(N) `rebuild_offsets_only` with an O(log N) Fenwick (binary indexed tree) so per-height-confirmation cost does not scale with transcript size.
**Requirements:** R-F.
**Dependencies:** none.
**Files:** `packages/desktop/src-tauri/src/acp/transcript_viewport/layout.rs` (modify `LayoutIndex`, `confirm_height`, `rebuild_offsets_only`, `row_offset_px`, `row_at_offset`, `visible_range`); possibly add `packages/desktop/src-tauri/src/acp/transcript_viewport/fenwick.rs`.
**Approach:** Keep the public `LayoutIndex` API identical (it already exposes `row_offset_px`, `row_at_offset`, `visible_range`, `confirm_height`, `total_height_px`). Internally back offsets with a Fenwick tree over per-row heights; `confirm_height` becomes a point-update; `row_offset_px`/`row_at_offset`/`visible_range` resolve via Fenwick prefix-sum descent (replacing the current `partition_point` on the flat `offsets` Vec in `index_at_or_before_offset`/`index_after_offset`). **Decision (resolves "visible_range path undefined"):** drop the flat `offsets: Vec<u64>` as the query backing — `index_at_or_before_offset` becomes an O(log N) Fenwick prefix-descent (`find largest i where prefix_sum(i) <= offset`), and `row_offset_px(i)` = `prefix_sum(i)`. A flat offsets array is materialized **only** when building a buffer push, over the buffer span (O(buffer_size), not O(N)). This keeps `confirm_height` truly O(log N) (no O(N) flat rebuild) and is the single source for both queries and slices. **Ordering trap (must observe):** compute `height_delta = new_height - row.height_px()` BEFORE mutating `row.confirmed_height_px`; if read after, `height_px()` already returns the new value, the delta is 0, and every confirmation becomes a silent Fenwick no-op (offsets stuck at estimates). Preserve existing version-aware confirmation semantics (`preserves_confirmed_heights_only_for_matching_versions`).
**Patterns to follow:** existing `layout.rs` unit tests as the behavioral contract to keep green.
**Execution note:** Characterization-first — the existing `layout.rs` tests already encode the contract; keep them passing, then add Fenwick-specific tests. This is a pure data-structure swap behind a stable API.
**Test scenarios:**
- Offsets match the previous flat-array computation for a mixed-height row set (`builds_total_height_and_row_offsets` parity). Covers R-F.
- `confirm_height` updates only the target row's contribution and shifts all subsequent offsets correctly (single point update).
- Re-confirming a previously-confirmed row (height X → Y) produces the correct prefix sum via point-update, verified by `total_height_px` and `row_offset_px` for rows after the updated index (guards the read-before-mutate ordering trap; a silent no-op fails this).
- Stale `version` confirmation is rejected; matching version is accepted (preserve existing behavior).
- `row_at_offset` returns the correct row at exact boundary, mid-row, and past-end (cap) offsets.
- Performance characterization: 100k synthetic rows, 10k random `confirm_height` calls completes within a generous CI budget and far faster than the flat-array baseline (assert relative, not wall-clock absolute).
**Verification:** `cargo test --lib layout` green incl. new Fenwick tests; existing offset/visible-range tests unchanged.

### U2. Viewport buffer slice + delta protocol types

**Goal:** Add the canonical buffer-push and buffer-delta payloads (rows + absolute offsets covering a buffer, plus `scrollAnchorCorrectionPx`/`scrollTopTarget`), parallel to the existing assistant-text delta.
**Requirements:** R-B, R-C, R-D, R-E.
**Dependencies:** U1 (buffer slice reads offsets from the index).
**Files:** `packages/desktop/src-tauri/src/acp/session_state_engine/protocol.rs` (new payload structs + serde); `packages/desktop/src-tauri/src/acp/transcript_viewport/viewport.rs` (buffer-slice + delta computation against a previous push); `packages/desktop/src/lib/services/acp-types.ts` (mirror types into `SessionStatePayload` union).
**Approach:** Add `ViewportBufferPush` (snapshot: `bufferStartIndex`/`bufferEndIndex` row-index bounds, rows, absolute `offsetsPx`, totalHeightPx, mode, viewportRevision) and `ViewportBufferDelta` (`fromViewportRevision`, `toViewportRevision`, prepended/appended rows, removedRowIds, totalHeightPx, optional `scrollAnchorCorrectionPx`, optional `scrollTopTarget`, optional `diagnostics`). **Boundary representation:** the wire carries **row-index** bounds; the pixel bounds `[startPx, endPx]` referenced in KTD1/the diagram/U4 are *derived* on the WebView from the included `offsetsPx` (first row offset; last row offset + height) — they are not separate wire fields. The scroll/confirm *intents* (U3) carry `anchorRowId` + the WebView's current `scrollTop` so Rust can compute `scrollAnchorCorrectionPx` as the cumulative confirmed-height delta above the anchor (see Decision 5). Extend `TranscriptViewport` with `buffer_window(...)` and `buffer_delta_since(prev, anchorRowId) -> ViewportBufferDelta`. Preserve the existing `diagnostics` field carried by `VisibleTranscriptWindowPayload`. Keep serde camelCase consistent with `VisibleTranscriptWindowPayload`.
**Patterns to follow:** `AssistantTextDeltaPayload` + `SessionStateDelta` (existing delta machinery); `VisibleTranscriptWindowPayload` field/serde conventions.
**Test scenarios:**
- Buffer slice around an interior offset includes the configured runway above and below; absolute offsets are correct. Covers R-B.
- Delta between two buffer states with scroll-down yields appended rows + removed top rows, no full re-send. Covers R-C.
- A height correction to an off-screen (above-viewport) row produces a non-zero `scrollAnchorCorrectionPx` equal to the cumulative shift above the anchor. Covers R-D.
- Follow-tail push includes `scrollTopTarget = totalHeightPx - viewportHeightPx`. Covers R-E.
- Buffer at the very top / very bottom clamps without negative offsets or over-read.
**Verification:** `cargo test --lib` green; TS types compile (`bun run check` exit 0).

### U3. Rust command + push wiring: emit buffer pushes/deltas instead of full windows

**Goal:** Replace the full-window response path with: an initial `ViewportBufferPush` on open/resize, then `ViewportBufferDelta` on scroll-intent and height-confirmation; follow-tail emits `scrollTopTarget`.
**Requirements:** R-A, R-C, R-D, R-E, R-H.
**Dependencies:** U1, U2.
**Files:** `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` (`build_visible_transcript_window_envelope_for_session` → buffer push/delta builder; reuse the existing resync-on-stale-revision behavior already added); `packages/desktop/src-tauri/src/acp/commands/transcript_viewport_commands.rs` (commands now return/emit buffer push/delta; keep BudgetExceeded-only error mapping).
**Approach:** `acp_scroll_transcript_viewport` becomes an intent that slides the buffer and returns a delta (or no-op when the new offset is still inside the current buffer and no refill is needed). **Three outcomes, not two:** (a) offset inside buffer → empty/no-op delta; (b) offset crossing the high-water mark → sliding delta; (c) offset *outside* `[bufferStartPx − overshoot, bufferEndPx]` (e.g. jump-to-top / `revealRow` far from the buffer on a 275k-px session) → a fresh `ViewportBufferPush` centered on the new offset, NOT a delta (a delta cannot bridge a non-contiguous jump and would render an empty buffer). `acp_resize_*` returns a fresh buffer push. `acp_confirm_transcript_viewport_height` returns a delta carrying `scrollAnchorCorrectionPx`. A gap-detected `requestFullPush` intent returns a fresh push that resets the WebView revision (see KTD9). Preserve the resync semantics (echo current canonical revision) from the retry-storm fix. Decide whether stale/no-op confirms still bump `viewport_revision` (empty sequenced deltas) or are suppressed — and keep that consistent with the WebView's gap detector. Mode changes (follow/detach) are decided in Rust and returned in the delta/push `mode`.
**Approach note (GOD):** This keeps Rust the authority for which rows/offsets/mode exist; the WebView only consumes. No reader fallback, no UI repair.
**Test scenarios:**
- Scroll intent landing inside the current buffer returns a no-op/empty delta (zero layout bytes). Covers R-A, R-C.
- Scroll intent crossing the high-water mark returns a delta sliding the buffer.
- Scroll intent far outside the current buffer (e.g. jump-to-top, or `revealRow` 100k px away on a 275k session) returns a fresh full `ViewportBufferPush`, not a delta. Covers R-A.
- A `requestFullPush` (gap recovery) returns a fresh push that resets the revision, even when the client revision is stale. Covers R-L.
- Height-confirm for an above-viewport row returns a delta with the correct `scrollAnchorCorrectionPx`. Covers R-D.
- Streaming append while following returns a delta with updated `scrollTopTarget`. Covers R-E.
- Stale-revision scroll/confirm still resyncs (echoes current canonical revision), no storm. (Regression of retry-storm fix.)
**Verification:** `cargo test --lib` green; live: console shows deltas/no-ops, not full windows, during scroll.

### U4. WebView local-resolution renderer (consume buffer, resolve offsets locally)

**Goal:** Make `scene-content-viewport.svelte` hold the pushed buffer and resolve visible rows + positions locally on scroll, with zero IPC on the paint path; emit refill intents at the high-water mark.
**Requirements:** R-A, R-H, R-I.
**Dependencies:** U2 (types), U3 (push/delta wiring).
**Files:** `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`; `packages/desktop/src/lib/acp/store/transcript-viewport-store.svelte.ts` (hold buffer + apply deltas); `packages/desktop/src/lib/acp/session-state/session-state-viewport-command-service.ts` (intent call shape if changed).
**Approach:** Store keeps `buffer { bufferStartIndex, bufferEndIndex, rows, offsetsPx, totalHeightPx, mode, viewportRevision }` (pixel bounds `[startPx,endPx]` derived from `offsetsPx`). **Store API contract (resolves "U4 store API unspecified"):**
- `applyBufferPush(push)` — replace the buffer wholesale and set `currentRevision = push.viewportRevision` (newer-wins ordering for snapshots).
- `applyBufferDelta(delta)` — guard `delta.fromViewportRevision === currentRevision`; on match splice prepended/appended/removed and set `currentRevision = delta.toViewportRevision`; on mismatch return a `Gap` result that the controller turns into a `requestFullPush` intent.
- `resolveVisible(scrollTop, viewportHeight): { rows, offsetsPx }` — pure function over the local buffer, no IPC; the paint path's only reader.
- `needsRefill(scrollTop, viewportHeight): boolean` and `isOutsideBuffer(scrollTop, viewportHeight): boolean` — drive the rAF intent (refill vs full-push request).

On scroll: keep the already-applied rAF-coalesced intent; the paint path calls `resolveVisible` (no `invoke`). When `needsRefill` crosses the high-water mark, the rAF intent additionally requests a refill; when `isOutsideBuffer`, it requests a fresh full push. Apply `scrollAnchorCorrectionPx` atomically with the new offset (single write, guarded against the canonical-offset-snap `$effect` oscillation per the existing `suppressNextScrollIntent` pattern). Add `overflow-anchor: none` to the scroll container. Keep `confirmRowHeight` but batch one message per frame and version-guard the `lastHeightPx = 0` reset. **Buffer-underrun skeleton (resolves design#5):** the scroll container's full height is always `totalHeightPx` (known even when rows aren't materialized); on `isOutsideBuffer` render a fixed-height spacer for the unmaterialized region (no row content) until the fresh push lands — the scroll height never collapses, so the scrollbar and position stay stable. **Detach affordance (resolves design#6):** expose a derived `showJumpToLatest = mode === 'detached' && isStreaming` boolean for the controller to render a presentational "jump to latest" control (the control lives in `@acepe/ui`; this unit only exposes the flag + a `requestFollowTail()` intent).
**Patterns to follow:** existing `applyVisibleWindow`/`isNewerVisibleWindow` revision-comparison in the store; existing `suppressNextScrollIntent` snap guard.
**Execution note:** This is the riskiest unit (scroll feel). Land behind the buffer types with the existing live Tauri MCP rAF benchmark as the acceptance gate.
**Test scenarios:**
- Store applies a `ViewportBufferDelta` (splice prepended/appended, drop removed) producing a contiguous buffer with monotonic offsets. Covers R-C.
- Store applies a `ViewportBufferDelta` only when `fromViewportRevision === store.currentRevision` (exact-chain); a delta with a mismatched `fromViewportRevision` is rejected and triggers a `requestFullPush`. (NOT the `>` newer-wins predicate — that is for full snapshots only.) Covers R-L.
- After a dropped/rejected delta, a `requestFullPush` → `ViewportBufferPush` restores a consistent buffer and resets the revision (no permanent freeze). Covers R-L.
- A follow push carrying `scrollTopTarget` received while a detach intent is in flight is NOT applied to `scrollTop` until the Rust ack confirms `followingTail` mode. Covers R-H.
- Applying a delta with `scrollAnchorCorrectionPx` adjusts the stored offset so the visible anchor row stays put. Covers R-D.
- Applying a follow-tail push with `scrollTopTarget` pins to bottom. Covers R-E.
- A scroll offset inside the buffer selects the correct visible row set from local offsets (unit-test the pure resolver function extracted from the component).
- `isOutsideBuffer` offset renders a fixed-height spacer sized from `totalHeightPx` (scroll height does not collapse) until the fresh push lands. Covers design#5.
- While in acknowledged `followingTail` mode, a viewport resize keeps the view pinned to bottom via live `clientHeight` (not a stale `scrollTopTarget`). Covers the resize race (Decision 4).
- `showJumpToLatest` is true exactly when `mode === 'detached' && isStreaming`, and `requestFollowTail()` re-enters follow mode. Covers design#6.
**Verification:** `bun run check` exit 0; live Tauri MCP session-70 rAF benchmark p95 ≤ 8.33ms within buffer; tail stays pinned during streaming.

### U5. Delete the WebView reconstruction fallback

**Goal:** Remove `resolveSceneEntry`'s entry-building branch; the WebView renders only rows present in the canonical scene/buffer.
**Requirements:** R-G.
**Dependencies:** U4; coordination with the concurrent agent on `desktop-agent-panel-scene.ts`.
**Files:** `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` (delete reconstruction branch); `packages/desktop/src/lib/acp/components/agent-panel/desktop-agent-panel-scene.ts` (ensure every buffer row maps to a scene entry — **co-owned; coordinate first**).
**Approach:** After U4, every row in the pushed buffer must already have a scene entry. Replace the build-on-miss branch with a hard invariant (missing entry = bug, not a render path). If the scene mapper cannot yet guarantee completeness due to the concurrent edit, mark this unit blocked and proceed with the rest — do not reintroduce a fallback.
**Execution note:** Behavior-preserving deletion; verify no row ever hits the removed branch via a dev-only assertion during QA, then remove the assertion.
**Test scenarios:**
- Every buffer row resolves to a scene entry for a representative session (no reconstruction path taken). Covers R-G.
- Removing the fallback does not change rendered output for session 70 (visual parity QA).
**Verification:** `bun run check` exit 0; `check:rust-owned-transcript-viewport` guard still green; live QA shows identical rows. Extend `scripts/check-rust-owned-transcript-viewport.ts` with a pattern that rejects inline construction of display scene-entry objects inside `scene-content-viewport.svelte` (e.g. hardcoded `kind: "user"|"assistantText"|"tool"` object literals), so R-G stays machine-enforced after the branch is deleted.

### U6. Remove the dead full-window path

**Goal:** Delete `VisibleTranscriptWindowPayload` and its command/store/consumer code once buffer push/delta fully replaces it (no coexistence).
**Requirements:** R-K.
**Dependencies:** U3, U4, U5.
**Files:** `packages/desktop/src/lib/services/acp-types.ts`; `packages/desktop/src/lib/acp/store/transcript-viewport-store.svelte.ts`; `packages/desktop/src-tauri/src/acp/session_state_engine/protocol.rs` + `runtime_registry.rs`; any remaining references found by grep.
**Approach:** Grep for `visibleTranscriptWindow` / `VisibleTranscriptWindow` and remove all producers/consumers. Update the two guard scripts if they reference the old type names.
**Execution note:** Pure deletion after the new path is proven; do this last so the new path is verified before the old one is removed.
**Test scenarios:**
- Test expectation: none — pure removal. Covered by the full suite staying green and live QA after deletion.
**Verification:** `cargo test --lib` + `bun run check` exit 0; no references to the old type remain; live QA unchanged.

---

## Scope Boundaries

**In scope:** the six units above — Fenwick index, buffer push/delta protocol, Rust wiring, local-resolution renderer, reconstruction deletion, dead-path removal.

### Deferred to Follow-Up Work
- **Virtualized-row accessibility (was U6 / R-J)** — split into its own plan because it is (a) outside this plan's stated perf/purity goals, (b) structurally underspecified (keyboard traversal model, focus retention when a focused row is evicted from the buffer), and (c) gated on a real constraint: native Cmd+F fires no hookable JS event, so full-transcript find requires an app-level search feature, not DOM retention. That follow-up owns: `role="list"`/`role="listitem"` + `aria-setsize`/`aria-posinset`, a roving-tabindex (or `aria-activedescendant`) keyboard model, focus-retention/reveal-on-focus for evicted rows, and an in-app find-across-transcript surface.
- SharedArrayBuffer transport (Rust writes the layout index to a SAB; JS reads via `Atomics.load()` in rAF). This is the theoretical byte/latency minimum on the DOM but requires COOP/COEP headers and is an optimization on top of Option C, not a prerequisite. Plan separately once Option C is proven.
- Tuning the buffer constant and high-water mark from real fling telemetry (ship a sane default; instrument later).

### Outside this product's identity
- Canvas/WebGL/GPUI rendering (abandons DOM accessibility/Find/selection). Recorded under Alternatives as the L1 north star only; not pursued.
- Cross-platform pixel-exact (L1) determinism — impossible with DOM text shaping and not a product requirement.

---

## Alternative Approaches Considered

| Option | Scroll transport | 120fps? | Byte-optimality | Determinism | Purity/SoC | Complexity | Why not chosen |
|---|---|---|---|---|---|---|---|
| **0. Current (full window per scroll)** | query-before-paint | No (~36fps) | No (overlapping full windows) | L3, L2 | Leaky (WebView reconstructs) | Low | The baseline being fixed |
| **A. Tactical (height-confirm guard + rAF coalesce + Rust overscan widen)** | same, fewer round trips | Better, still floored | No | L3 | Same leak | Low | Buys ~60fps but does not remove the latency floor or the reconstruction smell |
| **B. Delta protocol only (no local buffer)** | window delta per intent, still query-before-paint | No for novel offsets | Yes | L3 | Cleaner | Med | Fixes bytes but keeps the blocking round trip |
| **C. Pushed layout index + local buffer + deltas (THIS PLAN)** | zero IPC per frame in buffer; async intent; delta refills | Yes (in buffer) | Yes | L3, L2 | Pure (Rust owns semantic position; WebView owns pixel position within canonical data) | Med-High | Chosen |
| **C+SAB** | layout index in SharedArrayBuffer, `Atomics` reads | Yes | Best | L3 | Pure, zero-copy | High (COOP/COEP) | Deferred optimization atop C |
| **D. Canvas/WebGL or GPUI + Rust text shaping** | Rust renders pixels | Yes | Yes | **L1** | Maximal | Very High; loses DOM a11y/Find/selection | Only L1 path; out of product identity (DOM stays) |

Tactical Option A overlaps with perf edits already in the working tree (rAF scroll coalescing applied; height-confirm version-guard pending). Those are a compatible down-payment toward C and need not be reverted, but they do not substitute for C.

**On the choice vs Option A (resolves "A dismissed without evidence" + single-session/opportunity-cost concerns):** the perceptual gap between 60fps (Option A's likely ceiling) and 120fps is *not* independently proven, so Option C is justified **primarily by purity and byte-optimality and by completing the already-started migration's R10/R11/R14 intent** — not by fps alone. The fps win is a bonus, not the load-bearing rationale. Evidence base: session 70 (~275k px) is the *worst-case* stress proof, not a typical session; the architecture is strictly neutral-to-positive at all sizes (zero in-buffer IPC regardless of transcript length, smaller payloads everywhere). Opportunity cost is bounded because the authoritative `LayoutIndex`/`TranscriptViewport` scaffolding already exists — this plan completes it rather than building net-new infrastructure, and the a11y unit (the largest net-new surface) is split out.

---

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Height-correction cascade jumps content under the finger | High (visible, common on first scroll of unmeasured session) | `scrollAnchorCorrectionPx` applied atomically with offset (R-D, U2/U3/U4); `overflow-anchor: none` (R-I) |
| Follow-tail divergence during rapid streaming | High (newest row briefly off-screen) | Explicit `scrollTopTarget` plus resize-invariant local pin-to-bottom while in acknowledged `followingTail` mode (R-E, Decision 4) |
| Buffer underrun on fast fling | Medium (brief skeleton) | 5× viewport buffer, refill at ≥40% runway; graceful skeleton, never a retry storm |
| Dual authority if WebView flips mode locally | High (GOD violation) | Optimistic prediction emits intent only; render mode flips on Rust ack (R-H, decision 4) |
| Concurrent agent owns scene mapper | Medium (merge conflict / incomplete entries) | U5 coordinates first; if blocked, U5 defers without reintroducing fallback; rest proceeds |
| Fenwick swap changes offset results subtly | High (layout drift) | U1 characterization-first against existing `layout.rs` tests; parity assertions |
| Scroll-feel regression | High (UX) | U4 gated on live Tauri MCP rAF benchmark before merge; behind the new types |

---

## System-Wide Impact

- **Rust:** `transcript_viewport/{layout,viewport}.rs`, `session_state_engine/{protocol,runtime_registry}.rs`, `commands/transcript_viewport_commands.rs`.
- **TypeScript:** `services/acp-types.ts`, `acp/store/transcript-viewport-store.svelte.ts`, `acp/session-state/session-state-viewport-command-service.ts`, `acp/components/agent-panel/components/scene-content-viewport.svelte`, possibly `desktop-agent-panel-scene.ts` (co-owned).
- **Guard scripts:** `scripts/check-transcript-virtualizer-deps.ts`, `scripts/check-rust-owned-transcript-viewport.ts` may need updates when the old full-window type is removed (U6).
- **Affected parties:** end users (scroll feel), the concurrent agent on the scene mapper (coordination), reviewers (canonical protocol change → GOD gate + `/document-review`).

---

## Execution Posture

GOD-gated canonical change. Before coding each Rust unit, re-confirm with `god-architecture-check` that the change moves/keeps truth upstream (it does: Rust still owns rows/order/offsets/mode; the WebView only resolves pixel position from pushed canonical numbers). TDD: U1 characterization-first; U2/U3 protocol tests before wiring; U4 gated on the live rAF benchmark. Do not commit without explicit user consent. Do not run `bun dev`. Coordinate on `desktop-agent-panel-scene.ts` before U5.

---

## Assumptions (headless — would normally be confirmed with the user)

1. **Target is Option C, not D.** The product keeps the DOM; L1 pixel-determinism is not required. (Grounded in the migration plan's explicit DOM-for-accessibility scope.)
2. **Buffer constant 5× viewport / 40% high-water mark** are sane starting defaults, tunable later from telemetry — not load-bearing on the protocol.
3. **The tactical perf edits already in the tree** (rAF coalescing applied; height-confirm version-guard pending) are kept as a down-payment and folded into U4 rather than reverted.
4. **U5 sequencing may wait on the concurrent scene-mapper work, but deferral is a scheduling constraint, not an acceptable end state.** The Purity success criterion is unmet until U5 lands; the plan is not "done" while the reconstruction fallback is still live. U5 never reintroduces a fallback — at worst it is temporarily blocked.
5. **No commit** of any of this (perf edits, retry-storm fix, or this plan's output) without explicit user consent.

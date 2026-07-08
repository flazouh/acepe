---
title: "refactor: DOM-authority transcript viewport (native scroll + content-visibility + JS anchoring)"
type: refactor
status: active
date: 2026-06-28
deepened: 2026-06-28
---

# refactor: DOM-authority transcript viewport

## Overview

Replace the Rust-owned virtualized transcript viewport with a **DOM-authority native-scroll** model, modeled on shadcn/ui `MessageScroller` and `stackblitz-labs/use-stick-to-bottom`.

Today Rust pushes a windowed slice of rows **plus pixel data** (`offsetsPx`, `totalHeightPx`, `bufferEndOffsetPx`), a `mode` (`followingTail` | `detached`), and `scrollTopTarget`/`scrollAnchorCorrectionPx`. A 1269-line TS "physical scroll adapter" (`transcript-viewport-webview-adapter.svelte.ts`, ~6 RAF loops) plus scroll/reveal/resize/height **commands** reconcile that against the live DOM. Scroll authority is split across an **async IPC boundary** that cannot converge.

After this change: **Rust is a pure ordered-row provider** (rows + stable ids + order + per-row `version`/streaming-tail, zero pixels). The **DOM owns `scrollTop`**. Rows render as real DOM with `content-visibility: auto` (browser skips off-screen work). A small ported `use-stick-to-bottom` controller does JS scroll-anchoring + live-edge follow.

## Problem Frame

Repeated severe regressions: after send the view jumps to the *first* user message; scrolling down shows a huge empty area; the user cannot scroll up; the viewport thrashes/remounts. Live capture: projection claimed **28 rows / 4088px** while **2 rows** rendered, `mode=detached`, `scrollTop=2789` in the void; DOM thrashed and the container remounted.

**Root cause:** `scrollTop` is a synchronous, frame-coupled, browser-owned quantity. Rust co-owning it via async round-trips means two state machines on different clocks with no shared "now"; the RAF loops/flags are compensation epicycles. (Second-opinion-confirmed.) **GOD alignment:** order/identity are canonical and stay in Rust; pixels are a view concern measured in the browser and were never canonical — removing them is GOD-aligning.

> **Diagnosis falsification (added per review).** Before committing Phase 2, Unit 0 captures a minimal characterization that reproduces the live failure (void + ghost spacer) and demonstrates it is the split-authority/`totalHeightPx`-vs-rows desync — not merely a local delta-expressiveness bug that a smaller fix would resolve. This both de-risks the decision and yields the regression fixture used for parity.

## Requirements Trace

- **R1.** While at the live edge, new tokens/rows stay in view (follow).
- **R2.** Any user interaction (wheel, touch, keyboard scroll keys, scrollbar drag, text selection) releases follow and preserves position.
- **R3.** On send: anchor the new user turn near the top (with a small previous-turn peek) **and keep follow engaged** so the streaming reply/tool-calls grow into view and stay followed — never strand the reply below the fold, never jump to the first message, never an empty void. *(Decision: anchor-near-top, per user; safeguard added per design review.)*
- **R4.** Prepending history does not move the content the reader is looking at.
- **R5.** A "jump to latest" affordance returns to the live edge and re-engages follow.
- **R6.** Opening a saved thread lands on the last user turn (falls back to bottom if it already fits). *(Decision: last-anchor, per user. Intentional drop: exact mid-scroll restore the old `detached` mode had — see System-Wide Impact.)*
- **R7.** Heavy rows (diffs, code, markdown, tool cards) at multi-thousand-row scale stay responsive (quantified gate in Unit 8).
- **R8.** Behavior parity — verified by **characterization tests/recorded traces of today's working behaviors ∪ R1–R12**, not a prose checklist — is reached **before** the old buffer/adapter is deleted.
- **R9.** Rust emits/consumes no pixel/scroll/mode data; the wire carries ordered rows + stable ids + per-row `version`/streaming-tail only.
- **R10.** When content appends while the reader is released (scrolled up), a **"new messages below" indicator** appears (carried on the jump-to-latest affordance) and clears on return to the edge.
- **R11.** Accessibility parity: the transcript is a keyboard-focusable scroll region (`tabindex`), streaming is announced via a live region (`aria-live="polite"`/`role="log"`), and programmatic scroll/anchor writes **preserve the active element and text selection**.
- **R12.** The **actively-streaming tail row always paints** (exempt from `content-visibility` skipping) so live output is never frozen — the primary supervise-a-run use case.

## Scope Boundaries

- Not changing the canonical transcript model (entry ids, order, tool/operation linkage, provider history parsing).
- Not changing message rendering (markdown, diffs, tool cards, token-reveal animation) beyond the `content-visibility` row wrapper and the tail-row paint exemption.
- Not changing composer, session lifecycle, permissions, or agent-panel header.

### Deferred to Separate Tasks

- **DOM-side virtualization (TanStack Virtual)** — only if the Unit 8 quantitative perf gate trips on real heavy transcripts.
- **Spring/velocity scroll animation** — instant-jump first; spring is a follow-up, and must be gated on `prefers-reduced-motion` when it lands.
- **Live-activity affordance** (jump-to-latest also conveying "agent still working below", not just "new content") — Open Question; small scope, high supervise-value; decide post-MVP.

## Context & Research

### Relevant Code and Patterns

TS — remove (pixel/adapter machinery):
- `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-webview-adapter.svelte.ts` (1269 lines, ~6 RAF loops)
- `.../logic/transcript-viewport-scroll-controller.ts`, `.../logic/transcript-viewport-height-confirm.ts`, `.../logic/transcript-viewport-flight-recorder.ts`
- `packages/desktop/src/lib/acp/session-state/session-state-viewport-command-service.ts`
- `packages/desktop/src/lib/acp/store/transcript-viewport-store.svelte.ts` (replaced by Unit 3)
- `packages/desktop/src/lib/acp/store/viewport-projection-controller.svelte.ts` **(+ its importers: `session-store-compose.ts`, `session-store.svelte.ts`, `session-connection-facade.ts`, `session-lifecycle-cleanup.ts`)** — found in review; was missing from the original list
- Tests: `.../logic/__tests__/transcript-viewport-scroll-controller.test.ts` and other viewport tests

TS — modify:
- `.../components/scene-content-viewport.svelte` (spacer+translateY → native scroll + content-visibility)
- `.../components/transcript-viewport-row-renderer.svelte`, `.../components/agent-panel-content.svelte`, `.../components/scroll-to-bottom-button.svelte`
- `.../logic/transcript-viewport-rendered-rows.ts` **and `.../logic/transcript-viewport-row-mapper.ts`** (drop `offsetPx`; keep row↔scene mapping)
- `packages/desktop/src/lib/services/acp-types.ts` **and `acp-types.test.ts`** (regenerated specta types; the test asserts the pixel-field wire shape and will change)
- Other TS asserting the pixel wire: `session-state-envelope-budget.test.ts`, `session-state-command-router.test.ts`, `agent-panel-pipeline-integration.test.ts`

TS — keep: `.../logic/should-auto-scroll-on-panel-activation.ts`

Rust — simplify (remove pixel surface; keep canonical rows/order/ids/`version`/streaming-tail):
- `session_state_engine/protocol.rs`, `session_state_engine/buffer_emission_tracker.rs`, `session_state_engine/viewport_buffer_producer.rs`, `session_state_engine/viewport_ledger.rs` (remove)
- `transcript_viewport/viewport.rs`, `transcript_viewport/layout.rs` (remove `mode`/`apply_scroll_intent`/`buffer_window`/offsets; keep row access)
- `commands/transcript_viewport_commands.rs` (remove scroll/reveal/resize/height commands) + registration
- **Wider blast radius found in review — grep before editing:** `bridge.rs`, `envelope_router.rs`, `reducer.rs`, `graph.rs`, `selectors.rs`, `snapshot_builder.rs`, `live_envelope_builder.rs`, `frontier.rs`, `anchor_ledger.rs` (any constructing/reading dropped fields)
- **CI guard:** `packages/desktop/scripts/check-rust-owned-transcript-viewport.ts` **+ its test** actively enforce the *Rust-owned* invariant this plan inverts — must be updated/removed, with a **superseding ADR** in `docs/adr/`.
- Keep: `transcript_viewport/row.rs`, `transcript_viewport/projection.rs`

New presentational UI (`@acepe/ui`, per MVC + `extract-to-ui-package`): new stick-to-bottom controller + scroll-container parts under `packages/ui/src/components/agent-panel/`; desktop keeps a thin Controller wrapper.

### Data path reality (per feasibility review)

Rows arrive via a **revision-driven request** (`acp_request_transcript_viewport_buffer` → `SessionStateEnvelope`), not an unsolicited push; the scroll-windowing lives in the *separate* `acp_scroll_/_resize_/_reveal_` commands (which pass `None` for scroll on the plain buffer request). So a rows-only fetch is feasible after stripping the others — but Unit 3 must keep issuing the revision-driven **request**, not assume an event stream.

### Testing strategy (per feasibility review — critical)

- `packages/ui` `bun test` (`*.test.ts`) has **no DOM**; `packages/desktop` registers happy-dom via `svelte-loader.ts`. **happy-dom has no layout engine** — `scrollHeight`/`clientHeight`/`getBoundingClientRect().height` return `0`, `scrollTop` is an unclamped stored number, and `content-visibility`/ResizeObserver are no-ops that never fire from layout.
- Therefore: **pure decision logic** → `*.test.ts` (run anywhere). **Anything touching DOM/scroll/observers** → `*.dom.vitest.ts` / `*.svelte.vitest.ts` (vitest + happy-dom), with metrics **stubbed** via `Object.defineProperty(el, "scrollHeight", {value, configurable:true})` and ResizeObserver callbacks **invoked manually** (precedent: `thinking-viewport-follow.test.ts`).
- Unit tests can prove the **arithmetic** (is-at-bottom math, anchor-correction deltas, transitions) only. **Real layout/paint behavior — content-visibility paint-skip, estimate→real stability, fling scroll, streaming-tail paint, flicker — is dev-app QA (`acepe-dev-app-qa`) against real heavy transcripts in the real WebKit WebView.** No unit test may claim to prove these.

### Institutional Learnings

- `docs/solutions/` — check for prior viewport/scroll notes.
- Memory `viewport-rewrite-content-visibility.md` (architecture + WebKit spike numbers), `qa-dom-verification.md`, `optimistic-session-identity.md` (pre-canonical id window — affects R3/R6 "latest user row"), `token-reveal-pipeline.md`/`claude-cli-streaming-cadence.md` (streaming fragility — R12), `feedback-red-tests-reproduce-real-behavior.md` (red test at the real seam — operationalized in Unit 0/parity).

### External References

- shadcn/ui MessageScroller — https://ui.shadcn.com/docs/components/radix/message-scroller
- stackblitz-labs/use-stick-to-bottom — https://github.com/stackblitz-labs/use-stick-to-bottom

### De-risk spike (already run, real Tauri macOS WebKit WebView)

`content-visibility:auto` ✅; `contain-intrinsic-size:auto` ✅; **`overflow-anchor` ❌** (WebKit). Off-screen row = estimate (88px), on-screen = real (150px); `scrollHeight` shifted **+810px** scrolling through → **JS anchoring is mandatory**. Real-WebKit stability over real heavy rows with fling is the Unit 2 dev-app gate.

## Key Technical Decisions

- **DOM owns `scrollTop`; Rust owns order/identity/version only.** (R9, GOD.)
- **Render all rows as real DOM with `content-visibility:auto; contain-intrinsic-size:auto <per-kind estimate>`.** Estimates are a **hard acceptance criterion** (close to real, to bound first-paint flicker), not "tune later". (R7.)
- **JS anchoring mandatory (WebKit).** ResizeObserver on the **content container** (one observer, not per-row) drives anchor correction; per-row size deltas read on demand. Corrections are inherently one frame late (observer fires post-layout) — acceptable for size *growth* with a stable tracked anchor; verified in dev-app QA. (R3, R4.)
- **On-send = anchor-near-top + follow-engaged.** Treat send as a follow-intent: scroll the new user turn near the top with a peek, but leave `released=false` so the streaming reply is followed into view. If the user then scrolls up, release + show the new-messages indicator (R10). (R3.)
- **`isAtBottom===true` forces `released=false`** (re-engage), so a short-then-grown transcript can't get stuck released. (R2/R5.)
- **Version-aware row store.** The rows store keys rendering on `{display_id, version}` (or version-aware diff), so an in-place survivor change (e.g. a completed turn clearing `active_streaming_tail`) re-renders even though the id is stable — preserving the "stuck Planning next moves" guard without pixels. (R12; adversarial B1.)
- **Streaming tail row paints** via `content-visibility:visible` while it is the active tail. (R12.)
- **Parity = characterization fixtures of today's working behaviors ∪ R1–R12**, captured in Unit 0, asserted before deletion. (R8.)
- **Imperative scroll tracking via `data-*`** (`data-at-bottom`, `data-autoscrolling`); no row re-renders on scroll.

## Open Questions

### Resolved During Planning / Review

- Virtualization needed? No by default (`content-visibility`); TanStack Virtual is a gated contingency.
- DOM-sole authority compatible with Rust history parsing? Yes — rows+ids+version stay canonical.
- content-visibility supported in our WebView? Yes; but no `overflow-anchor` → JS anchoring required.
- On-send behavior? **Anchor-near-top + keep-follow** (user decision + design safeguard).
- Reopen position? **Last user turn** (user decision).

### Deferred to Implementation

- Per-row-kind `contain-intrinsic-size` estimates (user/assistant/tool/diff) — set against real transcripts; hard criterion, not optional.
- Exact wire shape (single "rows changed" push vs. pixel-free append/prepend/remove deltas) — decide in `protocol.rs`.
- "Latest user row" during the optimistic pre-canonical window (id not yet canonical) — see Unit 5 test scenario.
- Whether a `scrollToMessage`/deep-link-reveal caller genuinely exists today — grep in Unit 0; if yes it's a thin parity shim, if no it's dropped (not a headline feature).

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
Rust canonical transcript (order + ids + version + streaming-tail)   [NO pixels/mode/scrollTopTarget]
        ▼ revision-driven request -> envelope (ordered rows)
TS rows store {rows, byId, order}  -- renders keyed on {id, version}
        ▼
<native overflow-y:auto viewport>   DOM owns scrollTop
  └─ row: content-visibility:auto; contain-intrinsic-size:auto <est>   (active tail -> visible)
        ▲  ResizeObserver(content container)
StickToBottom controller (DOM-only):
  • isAtBottom = scrollHeight - scrollTop - clientHeight <= threshold   (same frame)
  • user interaction (wheel/touch/key/scrollbar/select) -> released=true
  • isAtBottom===true -> released=false (re-engage)
  • on append/resize: following&&!released -> scrollTop=bottom ; else preserve tracked anchor (Δabove) + set hasUnreadBelow
  • onSend(userRow): scroll userRow near top (peek) AND released=false (keep follow)
  • jumpToLatest(): released=false; scrollTop=bottom; clear hasUnreadBelow
  • openAt(lastUserTurn) on thread open
```

## Implementation Units

> Phased. `god-architecture-check` before Phase 3 (wire change) and before any deletion. `extract-to-ui-package` for the new `@acepe/ui` parts. Phases 1–2 may start now; **Phases 3–4 (irreversible Rust-wire change + deletion) are sequenced after the in-flight agent-panel WIP merges** (parallel-WIP risk).

### Phase 0 — Falsify + baseline

- [x] **Unit 0: Reproduce the live failure + capture current-behavior parity fixtures** — done. Caller map + resolved scope + parity QA checklist in `docs/solutions/transcript-viewport-dom-authority-baseline.md`; repro in `__tests__/viewport-desync-baseline.test.ts` (3 green). **Scope resolved:** no `scrollToMessage`/deep-link caller and no scroll keybinding caller exist → jump-to-message dropped, no shims; `review-*` scroll methods are the separate diff viewer. **Deviation:** repro is a pure `.test.ts` compile-coupled to `ViewportBufferPush` (a tripwire that breaks at the Unit 6 wire-strip), **not** `.dom.vitest.ts` — happy-dom has no layout engine, so a DOM void test would false-pass (0 heights); the void + the 7 working behaviors are layout phenomena verified in dev-app QA at Unit 7 cutover (checklist in the note).

**Goal:** A recorded repro of the void/ghost-spacer failure proving the structural cause, plus characterization fixtures of today's *working* behaviors to diff against later.

**Requirements:** R8 (parity), diagnosis falsification.

**Files:**
- Create: `docs/solutions/` note + a fixed transcript fixture; recorded DOM traces under the test dir.
- Create: `packages/desktop/src/lib/acp/components/agent-panel/__tests__/viewport-parity-baseline.dom.vitest.ts`

**Approach:** Grep all callers of the viewport commands (keybindings, deep-link reveal, header actions, `prepareForNextUserReveal`) and record their current correct behavior. Capture the broken-state repro (stubbed metrics reproducing 28-rows/4088px-vs-2-rendered) to confirm the desync is structural, not a delta-expressiveness bug.

**Execution note:** Characterization-first (memory `feedback-red-tests-reproduce-real-behavior.md`).

**Test scenarios:**
- Characterization: enumerate + record each current working behavior (follow, scroll-up-hold, prepend-no-jump, reveal-latest-user, keybinding scroll, deep-link reveal if present).
- Repro: a constructed projection with `totalHeightPx`≫rendered rows yields the void; assert this is the failure shape the rewrite must eliminate.

### Phase 1 — Prove the controller (de-risk)

- [x] **Unit 1: Port `useStickToBottom` to a framework-agnostic Svelte module** — DONE. Pure module + 20 tests (`stick-to-bottom.ts`); DOM wiring `stick-to-bottom-effects.ts` (`createStickToBottomController` + `use:` action + `applyScrollAction`/`readScrollMetrics`) + 13 `.dom.vitest.ts` green (programmatic guard, release/re-engage, follow-pin, anchor-preserve vs unread-below heuristic, jump-to-latest, on-send anchor-near-top, destroy teardown). No `$effect`; RO guarded.

**Goal:** DOM-only controller owning follow/release/anchor/unread logic; no app/Rust deps.

**Requirements:** R1, R2, R4, R5, R10, R11.

**Dependencies:** None.

**Files:**
- Create: `packages/ui/src/components/agent-panel/stick-to-bottom.ts` (pure: is-at-bottom, transitions, anchor math, `hasUnreadBelow`, focus/selection preservation policy)
- Create: `packages/ui/src/components/agent-panel/stick-to-bottom-effects.ts` (DOM wiring via a Svelte `use:` action: scroll/interaction listeners + one container ResizeObserver, guarded by `typeof ResizeObserver !== "function"`, teardown in the action return)
- Test: `packages/ui/src/components/agent-panel/__tests__/stick-to-bottom.test.ts` (pure math), `.../stick-to-bottom-effects.dom.vitest.ts` (DOM, stubbed metrics + manual observer)

**Execution note:** Test-first; highest-risk logic. No `$effect` — lifecycle lives in the `use:` action.

**Patterns to follow:** `@acepe/ui` `*-state.ts`/`*-effects.ts` split; ResizeObserver-in-`use:`-action precedent in `agent-assistant-message.svelte`; pure-function style from the (being-deleted) scroll-controller.

**Test scenarios:**
- Happy: at bottom + grow ⇒ pinned; released + grow ⇒ position unchanged + `hasUnreadBelow=true`.
- Edge: anchor row above grows by Δ ⇒ scrollTop adjusted by Δ (tracked row screen-Y stable); shrink while following ⇒ stays pinned; is-at-bottom threshold boundary.
- Transition: user wheel/touch/key/scrollbar/select ⇒ released; `isAtBottom===true` ⇒ released=false (re-engage, can't get stuck); `jumpToLatest()` ⇒ pinned + unread cleared.
- Guard: programmatic scroll-to-bottom not mis-read as user scroll-away (no spurious release).
- A11y: programmatic scroll preserves `document.activeElement` and a non-empty selection (stubbed).

- [ ] **Unit 2: Anchor-correction arithmetic vs recorded spike numbers (+ dev-app stability gate)**

**Goal:** Prove the anchor math holds against the measured estimate→real jumps; the *real* stability gate is dev-app QA.

**Requirements:** R4, R7.

**Dependencies:** Unit 1.

**Files:**
- Create: `packages/ui/src/components/agent-panel/__tests__/stick-to-bottom-anchoring.dom.vitest.ts` (hand-driven: stub estimate→real size changes via mocked rects + manual ResizeObserver)

**Approach:** Simulate the spike (88→150px, +810px) and assert anchor correction keeps the tracked row stationary across a scroll-up sequence. This proves arithmetic only.

**Execution note:** The **stability acceptance is a dev-app QA item** — real WebKit, largest real transcript (heavy diffs/code/tool cards), with **fling/momentum scroll** — recorded per `acepe-dev-app-qa`. Phase 1 is not "de-risked" until that passes.

**Test scenarios:**
- Arithmetic: scroll up through 50 simulated estimate→real rows ⇒ tracked anchor screen-Y within ±2px each step; late ResizeObserver fire ⇒ correction still applied, no cumulative drift; rapid multi-change frame ⇒ no oscillation.
- Dev-app QA (recorded, not unit): real heavy transcript, slow + fling scroll-up ⇒ no jump/flicker beyond threshold.

### Phase 2 — Build the new view (parallel to old)

- [x] **Unit 3: Version-aware ordered-rows store** — DONE (GOD-cleared: canonical-narrowing, keys on Acepe `rowId`+`version`, no pixels). Pure reducers `transcript-rows-store.ts` (`applyRowsPush`/`applyRowsDelta`/`renderKey` + wire-boundary `rowsPushFromBuffer`/`rowsDeltaFromBuffer` that drop all pixel fields) + reactive `transcript-rows-store.svelte.ts`; 11 bun tests green incl. **B1** (tail-clear + version bump ⇒ `renderKey` changes ⇒ no stuck "Planning"). **Deferred:** dropping `offsetPx` from `transcript-viewport-rendered-rows.ts` is moved to **Unit 4** — its only live consumer (`scene-content-viewport.svelte:143` translateY) is rewritten there; removing it in Unit 3 would break the parallel-to-old path for no benefit (new store never touches `rendered-rows`).

**Goal:** A reactive list of canonical rows keyed on `{display_id, version}`, no pixels/mode/offsets, that re-renders in-place survivor changes.

**Requirements:** R9, R12.

**Dependencies:** None (reads the existing revision-driven buffer request, ignoring pixel fields).

**Files:**
- Create: `packages/desktop/src/lib/acp/store/transcript-rows-store.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/transcript-rows-store.test.ts`
- Modify: `.../logic/transcript-viewport-rendered-rows.ts`, `.../logic/transcript-viewport-row-mapper.ts` (drop `offsetPx`)

**Approach:** Store `{rows, byId, order}`; render key = `id + ":" + version` so a stable id with a changed version (or cleared streaming-tail) remounts/updates. Keep issuing the revision-driven request.

**Execution note:** Red test first reproducing the "stuck Planning next moves" state through the **new** path before the old producer is touched.

**Test scenarios:**
- Happy: push N rows ⇒ N rows in canonical order keyed by id; append/prepend/remove ⇒ correct ordered list.
- **Stuck-indicator (B1):** a survivor row whose `active_streaming_tail` clears with a stable id and bumped `version` ⇒ the rendered row updates (no perpetual "Planning…"); a red test reproducing today's stuck state must go green here.
- Edge: duplicate id last-write-wins; empty session ⇒ empty list.

- [~] **Unit 4: Native-scroll viewport with content-visibility, unread indicator, a11y** — *presentational half DONE; Controller integration pending.* Created `@acepe/ui` `message-scroller.svelte` (focusable `role="log"` region, native `overflow-y:auto`, `{@attach}` stick-to-bottom controller, release-driven jump-to-latest + unread), `message-scroller-item.svelte` (`content-visibility:auto`/`contain-intrinsic-size:auto <est>`; active tail → `visible`; `data-anchor`/`data-row-id`), `message-scroller-types.ts` (per-kind estimate seeds). 5 `dom.vitest` green (order, tail opt-out, anchor attrs, release shows jump, onReady). Barrels updated. **REMAINING:** rewrite `scene-content-viewport.svelte` (Controller: rows from Unit 3 store, render `@acepe/ui` parts, **remove the adapter**, drop `offsetPx` from `rendered-rows`), then dev-app QA (fling/heavy-rows = Unit 2 gate).

**Goal:** Presentational scroll container rendering all rows as real DOM with `content-visibility`, wired to Unit 1; unread indicator; a11y; tail-row paint exemption. No spacer/translateY.

**Requirements:** R1, R2, R5, R7, R10, R11, R12.

**Dependencies:** Unit 1, Unit 3.

**Files:**
- Create: `packages/ui/src/components/agent-panel/message-scroller.svelte` (viewport: `overflow-y:auto`, `tabindex="0"`, `role="log"`/`aria-live="polite"` content, jump-to-latest slot with unread state)
- Create: `packages/ui/src/components/agent-panel/message-scroller-item.svelte` (`content-visibility:auto; contain-intrinsic-size:auto <est>`; active tail → `content-visibility:visible`; `data-anchor`)
- Modify: `.../components/scene-content-viewport.svelte` (Controller wrapper: rows from Unit 3, render `@acepe/ui` parts; remove adapter)
- Modify: `.../components/transcript-viewport-row-renderer.svelte`, `.../components/scroll-to-bottom-button.svelte` (jump-to-latest + unread badge; hidden at bottom)
- Test: `.../__tests__/message-scroller.dom.vitest.ts`

**Approach:** Normal flow list; `content-visibility` does perf work; per-kind intrinsic-size lookup (hard criterion). Controller binds via `use:` action.

**Execution note:** Build to green against Unit 1/2; then dev-app QA per QA mandate.

**Patterns to follow:** shadcn MessageScroller part split; existing `@acepe/ui` agent-panel components.

**Test scenarios:**
- Happy: render 200 rows ⇒ DOM order correct; off-screen items carry `content-visibility:auto`; active tail carries `content-visibility:visible`.
- Unread: append while released ⇒ jump-to-latest shows unread state; click ⇒ pinned + cleared.
- A11y: viewport focusable; content is a live region; keyboard PageDown/arrows scroll AND release follow; programmatic scroll preserves focus/selection.
- Edge UX: empty ⇒ nothing renders/jumps, no phantom button; content ≤ viewport ⇒ no anchor scroll, follow bottom, button hidden; single message.
- Streaming + a11y: streaming tail stays announced (verify in WebKit; dev-app QA).
- Dev-app QA (recorded): fast-scroll into never-rendered heavy rows ⇒ acceptable placeholder flicker (estimates tuned).

- [ ] **Unit 5: On-send anchor-near-top-keep-follow + open-at-last-turn**

**Goal:** On send, anchor the new user turn near top with a peek **and keep follow engaged**; open saved threads at the last user turn.

**Requirements:** R3, R6.

**Dependencies:** Unit 4.

**Files:**
- Modify: `.../stick-to-bottom.ts` (openAt / anchor-to-row / send-as-follow-intent)
- Modify: `.../components/agent-panel-content.svelte` (preserve only the **used** public methods — `scrollToBottom`, `prepareForNextUserReveal`, `scrollToTop`; a thin scroll-to-message shim **only if** Unit 0 found a real caller)
- Modify: `.../components/scene-content-viewport.svelte` (drive open-position + on-send anchor from the canonical "latest user row")
- Test: `.../__tests__/stick-to-bottom-open-position.dom.vitest.ts`

**Approach:** "Latest user row" comes from the canonical row list (stable id) — this is the root fix for "jump to first message". On send: anchor that row near top (peek) with `released=false` so the reply follows into view. **Scope note:** `scrollToMessage`/jump-to-message is dropped (maps to no requirement) unless Unit 0 proves a real deep-link caller.

**Test scenarios:**
- Happy: send ⇒ new user row anchored near top, reply streams below and is followed (not stranded); never jumps to first message.
- Open: thread with history ⇒ lands at last user turn; last turn already fits ⇒ falls back to bottom.
- Edge (design): tall user message + short viewport ⇒ reply's first lines stay visible (cap peek/anchor) and follow engaged.
- Edge: rapid send (send again before reply finishes) ⇒ latest send wins the anchor, no thrash.
- Edge (optimistic id): send during the pre-canonical window (latest user row id not yet canonical) ⇒ anchors the optimistic row, reconciles to canonical id without a jump.

### Phase 3 — Demote Rust to a row provider (sequence after parallel WIP merges)

- [ ] **Unit 6: Strip the pixel/mode/scroll surface from the Rust wire + retire commands + supersede the guard**

**Goal:** Rust emits ordered rows + ids + version only; no pixels/mode/scroll; scroll/reveal/resize/height commands removed; the Rust-owned-viewport CI guard + ADR superseded.

**Requirements:** R9.

**Dependencies:** Units 3–5 live in the panel and at parity; **the old adapter/command path retired or guarded first** (its pixel inputs must not be read after they're removed) — practically, do Unit 7 cutover immediately before/with the wire strip so nothing reads the stripped fields.

**Files:**
- Modify: `session_state_engine/protocol.rs` (drop pixel/mode/scroll fields), `buffer_emission_tracker.rs` (emit rows/pixel-free deltas), `transcript_viewport/viewport.rs` + `layout.rs`
- Remove: `session_state_engine/viewport_ledger.rs`, `commands/transcript_viewport_commands.rs` (+ registration); simplify/remove `viewport_buffer_producer.rs`
- **Grep + update the wider blast radius** (review): `bridge.rs`, `envelope_router.rs`, `reducer.rs`, `graph.rs`, `selectors.rs`, `snapshot_builder.rs`, `live_envelope_builder.rs`, `frontier.rs`, `anchor_ledger.rs`
- Modify: `services/acp-types.ts` (regenerated) + `acp-types.test.ts`, and TS wire-shape tests (`session-state-envelope-budget.test.ts`, `session-state-command-router.test.ts`, `agent-panel-pipeline-integration.test.ts`)
- Modify/remove: `scripts/check-rust-owned-transcript-viewport.ts` + its test
- Create: `docs/adr/NNNN-dom-authority-transcript-viewport.md` (supersedes the Rust-owned-viewport ADR)
- Test: update `buffer_emission_tracker.rs` + `transcript_viewport/viewport.rs` tests to assert ordered-row emission only (keep row-content/identity/order assertions; delete pixel/mode/window assertions)

**Approach:** Keep efficient append/prepend/remove deltas — without pixel fields. Preserve the in-place-survivor (streaming-tail clear) signal on the canonical row; the consumer's version-aware store (Unit 3) does the re-render.

**Execution note:** `god-architecture-check` first. Characterization-first: row-content/order/version tests stay green throughout; only pixel/mode tests are deleted. Run a **full reference grep** for each dropped field before editing — the real surface is ~15+ sites, not the 7 originally listed.

**Test scenarios:**
- Happy: a turn streams ⇒ emission carries changed rows with stable ids + bumped version, correct order, **no pixel fields**.
- Edge: prepend history ⇒ prepend delta with ids, no offsets; tool completes in place ⇒ version bumps, id stable, streaming-tail clears (drives Unit 3's re-render).
- Regression: canonical-entry-id + tool↔operation linkage invariants hold (reuse existing assertions); `acp-types.test.ts` reflects the pixel-free wire.

### Phase 4 — Cut over and delete

- [ ] **Unit 7: Cut over the panel, delete the old machinery, assert parity, migrate tests**

**Goal:** The panel uses the new viewport exclusively; old buffer/adapter/controller/commands/projection-controller gone; suite green; parity proven.

**Requirements:** R8.

**Dependencies:** Units 4–6 at parity (Unit 0 fixtures pass against the new path in dev-app QA).

**Files:**
- Remove: `transcript-viewport-webview-adapter.svelte.ts`, `transcript-viewport-scroll-controller.ts`, `transcript-viewport-height-confirm.ts`, `transcript-viewport-flight-recorder.ts`, `session-state-viewport-command-service.ts`, `transcript-viewport-store.svelte.ts`, `viewport-projection-controller.svelte.ts` (rewire its 4 importers), obsolete viewport tests
- Verify: full `bun test` + `cargo nextest run` green; `bun run check` clean; no dangling imports

**Approach:** Delete only after the Unit 0 parity fixtures (current good behaviors ∪ R1–R12) pass on the new path.

**Execution note:** Final dev-app QA against R1–R12 (recorded). Then `ce:review` + `ce:compound`.

**Test scenarios:**
- Parity (Unit 0 fixtures): every recorded current behavior reproduced on the new path.
- Integration (dev-app, recorded): send→anchor-top-keep-follow→reply-visible; scroll-up holds + unread indicator; prepend holds; jump-to-latest re-follows; reopen at last user turn.
- Regression: no references to removed modules (typecheck); suites green.

### Phase 5 — Contingency (gated)

- [ ] **Unit 8 (gated): DOM-side TanStack Virtual fallback**

**Goal:** Add DOM-side virtualization **only if** the quantitative perf gate trips.

**Requirements:** R7.

**Dependencies:** Unit 4. **Gate (numeric):** on a named worst-case real transcript (record row count + total DOM nodes + heap), sustained scroll drops frames below 55fps or scroll-input latency exceeds ~50ms, or mounted-component/observer memory exceeds an agreed ceiling.

**Approach:** Mirror shadcn's optional TanStack Virtual path; viewport stays the scroll element; scroll authority stays in the DOM; nothing crosses IPC. Note the controller observes the *content container*, so virtualization + anchoring coexist.

**Test scenarios:**
- Happy: N rows render only visible window + overscan; scroll smooth.
- Edge: anchoring + virtualization coexist (jump-to-message mounts the target).
- (Implemented only if the gate trips; record the triggering measurement in the unit.)

## System-Wide Impact

- **Interaction graph:** removes the scroll/reveal/resize/height Tauri commands + envelope round-trips and `viewport-projection-controller.svelte.ts` (rewire its 4 importers in session-store/lifecycle). Grep all command callers (keybindings, deep-link reveal, header actions) in Unit 0.
- **Error propagation:** session-open/attachment errors must still surface via the session-state envelope path, not the deleted viewport commands/projection-controller recovery.
- **State lifecycle risks:** removing the buffer store removes a source of truth — grep for any `bufferProjection.mode/offsets/totalHeight` reader before delete.
- **API surface parity:** preserve `agent-panel-content.svelte`'s used public methods; `scrollToMessage` is net-new and dropped unless a real caller exists.
- **Integration coverage:** content-visibility × token-reveal (R12 tail exemption); content-visibility × screen-reader live region (R11) — both dev-app-verified.
- **Unchanged invariants:** canonical transcript order, entry-id identity, tool↔operation linkage, provider history parsing — explicitly unchanged.
- **Intentional behavior changes (call out, not accidents):** (1) reopen lands at last user turn, **dropping exact mid-scroll restore** the old `detached` mode had; (2) the Rust-owned-viewport architecture invariant is **superseded** (new ADR + guard update).

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| JS anchoring can't hide estimate→real jumps on heaviest rows / one-frame-late ResizeObserver | Med | High | Phase 1 Units 1–2 prove math; **dev-app gate on real WebKit + fling**; tune per-kind estimates (hard criterion); Unit 8 fallback |
| Stuck-"Planning" guard lost when id-keyed | Med | High | Unit 3 version-aware store + red test through the new path before deleting the producer |
| Wire-strip blast radius bigger than listed (~15+ sites) + CI guard + ADR | High | Med | Unit 6 full reference grep; supersede guard + ADR; god-architecture-check |
| content-visibility freezes the streaming tail (a11y + visual) | Med | High | R12: active tail `content-visibility:visible`; dev-app verify announce + paint |
| Irreversible Phases 3–4 collide with heavy parallel agent-panel WIP | High | Med | **Sequence Phases 3–4 after the in-flight WIP merges**; build Phases 1–2 as a genuinely parallel component first |
| Parity regressions surface only in real use (history repeats) | Med | High | R8: Unit 0 characterization fixtures of today's good behaviors; assert before deletion |
| Testing illusion (jsdom "proves" stability it can't) | Med | Med | Testing-strategy section: arithmetic in `*.dom.vitest.ts` with stubbed metrics; stability/paint = dev-app QA only |

## Alternative Approaches Considered

- **More reconciliation flags** — rejected: structural split-authority can't converge (second-opinion + adversarial agreed the rewrite is justified).
- **TS owns scroll but Rust still emits pixels/offsets** — rejected: still ships pixels across IPC; keeps the spacer/window desync class.
- **DOM-side TanStack Virtual as default** — deferred to a quantitatively gated fallback; the spike suggests content-visibility suffices.

## Phased Delivery

- **Phase 0 (Unit 0):** falsify + baseline (parity fixtures + repro). Now.
- **Phase 1 (Units 1–2):** prove the controller; dev-app stability gate on real WebKit. Now.
- **Phase 2 (Units 3–5):** build the new view + version-aware store in parallel; wire into the panel behind a switch. Now.
- **Phase 3 (Unit 6):** demote Rust (wire change; god-architecture-check; guard+ADR). **After parallel agent-panel WIP merges.**
- **Phase 4 (Unit 7):** cut over, delete, assert Unit-0 parity, migrate tests. **After Phase 3.**
- **Phase 5 (Unit 8):** virtualization fallback only if the numeric gate trips.

## Sources & References

- Memory: `viewport-rewrite-content-visibility.md`
- shadcn/ui MessageScroller — https://ui.shadcn.com/docs/components/radix/message-scroller
- stackblitz-labs/use-stick-to-bottom — https://github.com/stackblitz-labs/use-stick-to-bottom
- Related code: `transcript-viewport-webview-adapter.svelte.ts`, `transcript-viewport-store.svelte.ts`, `viewport-projection-controller.svelte.ts`, `session_state_engine/buffer_emission_tracker.rs`, `viewport_buffer_producer.rs`, `transcript_viewport/viewport.rs`, `scripts/check-rust-owned-transcript-viewport.ts`
- Gates: `god-architecture-check`, `extract-to-ui-package`, `acepe-dev-app-qa`

---
module: agent-panel/transcript-viewport
tags: [scroll, viewport, content-visibility, parity, refactor, god-architecture]
problem_type: refactor-baseline
---

# Transcript viewport — DOM-authority rewrite baseline (Unit 0)

Falsification + parity baseline for the DOM-authority transcript-viewport rewrite
(plan `docs/plans/2026-06-28-002-refactor-transcript-viewport-dom-authority-plan.md`).
Captured **before** any Phase 2+ change so the cutover (Unit 7) can be diffed
against the behaviors that work today, and so the Phase 3 wire-strip knows its
exact blast radius.

## The structural failure (falsified, not a delta bug)

Live-observed broken state: the projection claimed **28 rows / 4088px** of layout
while only **2 rows** were actually rendered → a large empty void below the last
real row, plus a ghost spacer that fights scroll-up.

Root cause is **dual scroll authority**, not a missing delta case:
`ViewportBufferPush` (`src/lib/services/acp-types.ts`) carries
`layoutRowCount` + `totalHeightPx` + `bufferEndOffsetPx` + `scrollTopTarget` +
`scrollAnchorCorrectionPx` as a **separate authority from `rows`**. The WebView
sizes a spacer to `totalHeightPx` but only renders the `rows` window, so any
divergence between "claimed layout" and "rendered window" is *expressible by
construction* — the void is the visible symptom of that divergence. No amount of
extra delta cases removes the divergence; only collapsing to a single authority
(rendered rows own height) does. See `viewport-desync-baseline.test.ts` for the
executable repro, and memory `viewport-rewrite-content-visibility.md` for the
WebKit spike (`content-visibility` ✅, `overflow-anchor` ❌ → JS anchoring is
mandatory).

**Parity invariant the rewrite must satisfy:** scrollable height derives from the
rendered rows (real DOM + `content-visibility` intrinsic sizes), and **no
`totalHeightPx`/`layoutRowCount`/offset pixel field crosses the Rust→WebView
wire**. When that holds, the void shape is *unrepresentable*.

## Caller map (Phase 3 wire-strip blast radius)

**Rust viewport commands** (`src-tauri/.../commands/transcript_viewport_commands.rs`):
`acp_request_transcript_viewport_buffer`, `acp_scroll_transcript_viewport`,
`acp_reveal_transcript_viewport_row`, `acp_resize_transcript_viewport`,
`acp_confirm_transcript_viewport_height`.

**Single TS funnel** — every invoke goes through
`src/lib/acp/session-state/session-state-viewport-command-service.ts`. Its three
consumers:

| Consumer | Uses | Fate |
|---|---|---|
| `store/viewport-projection-controller.svelte.ts` | `requestTranscriptViewportBuffer` (rows request) | **Survives in spirit** — Unit 3 keeps a revision-driven *rows* request; drops pixels |
| `components/agent-panel/logic/transcript-viewport-webview-adapter.svelte.ts` (~1300 LOC) | scroll / reveal / resize | **Deleted** (Unit 7) |
| `components/agent-panel/logic/transcript-viewport-height-confirm.ts` | `confirmTranscriptViewportHeight` | **Deleted** (Unit 6/7) |

**The adapter has a single consumer**: `components/agent-panel/components/scene-content-viewport.svelte`
(~12 `viewportAdapter.*` reconcile/handle call sites). Clean cut.

**Surviving public methods** (keep at parity) and their callers:

| Method | Driven by | Requirement |
|---|---|---|
| `prepareForNextUserReveal` | `agent-panel.svelte` `onWillSend` (send moment) | R3/R6 — on-send anchor near top |
| `scrollToBottom` | `agent-panel.svelte` header `onScrollToBottom` + `scrollToBottomOnTabSwitch` | jump-to-latest |
| `scrollToTop` | `agent-panel.svelte` header `onScrollToTop` | — |

"Latest user row" seam today: `scene-content-viewport.svelte` `latestVisibleUserRowId()`
(feeds both `dispatchRevealForRow` and `prepareForNextUserReveal`). Unit 5 must
source this from the canonical row list (stable id), incl. the optimistic
pre-canonical window (memory `optimistic-session-identity.md`).

## Resolved scope questions

- **No `scrollToMessage` / deep-link reveal caller exists anywhere** (`grep` clean).
  Jump-to-message maps to no requirement → **dropped**, no shim needed.
- **No scroll/viewport keybinding callers** (`src/lib/keybindings` grep clean).
  No keybinding shim needed.
- `scrollToTop`/`scrollToBottom` in `review-*` / `review-diff-view-state.svelte.ts`
  are the **diff viewer**, a separate subsystem — **out of scope**.

## Parity checklist — current working behaviors (re-verify in dev-app QA at Unit 7 cutover)

These are layout/interaction behaviors; per the QA mandate (and happy-dom having
no layout engine) they are verified in the **real Tauri WebView**, not unit tests.
Record each via `acepe-dev-app-qa` before deleting the old path:

1. **Follow tail** — at bottom, streaming/append keeps the latest content pinned.
2. **Scroll-up hold** — scrolling up stays put; does *not* snap back to bottom.
3. **Prepend-no-jump** — loading older history above the viewport does not move
   the visually-anchored row.
4. **Reveal latest user row** — on send, the just-sent user row is brought into a
   readable position (the rewrite changes this to anchor-near-top; record the old
   behavior for the diff).
5. **Jump to bottom** — header action / tab-switch returns to the live edge.
6. **Scroll to top** — header action reaches the first row.
7. **Heavy-row stability** — scrolling through diffs/code/tool cards on the
   largest real transcript, incl. fling/momentum (this is the Unit 2 gate).

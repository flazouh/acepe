# ADR-0003: Use DOM-authority scrolling for the transcript viewport

## Status
Accepted — 2026-06-29

## Context
The old transcript viewport split scroll authority across Rust and the WebView:

```text
Rust sent: rows + totalHeightPx + offsetsPx + mode + scroll targets
WebView rendered: the rows that actually existed in the DOM
```

When those two facts disagreed, the UI could show blank scroll space. The WebView
could only guess how to reconcile Rust's claimed pixels with real rendered row
heights.

## Decision
- Rust sends ordered transcript rows only: row identity, row version, row content,
  operation links, interaction links, and diagnostics.
- Rust does not send viewport pixels, offsets, scroll modes, spacer height, or
  scrollTop targets.
- The WebView uses normal DOM flow and native scrolling. `@acepe/ui` owns the
  stick-to-bottom behavior because it can read the real DOM.
- Session state keeps a per-session rows controller, not a pixel viewport
  projection.
- Old scroll/reveal/resize/height-confirm commands are removed from the active
  transcript viewport path.

## Consequences
- The old "claimed height but missing rows" blank-space bug is unrepresentable on
  the Rust -> WebView wire.
- Reopening a saved session anchors to the latest user turn in the DOM, then
  native scroll behavior takes over.
- Large transcripts are windowed by a JS-owned virtual layout
  (`message-scroller-virtual-layout.ts`) above `VIRTUALIZATION_ROW_THRESHOLD`
  (200 rows), with ResizeObserver-measured row heights feeding the next-row
  estimate, JS-driven scroll-anchoring, and `contain: layout style paint` on
  individual rows — not a Rust-computed spacer. (This mechanism replaced an
  earlier browser-`content-visibility`-based approach; see Amendments below.)
- Any future transcript viewport feature that needs pixels must stay on the DOM
  side unless it becomes a canonical transcript fact.

## Amendments

### 2026-07-06 — content-visibility replaced with a JS virtualizer

At acceptance (2026-06-29) the Consequences section said large transcripts
relied on browser `content-visibility` and row containment instead of an
app-owned virtual spacer. That stopped being true nine days later.
`29e5ab67b` ("chore: checkpoint current acepe work", 2026-07-06) removed the
`content-visibility` CSS and, in the same commit, introduced
`VIRTUALIZATION_ROW_THRESHOLD` and `message-scroller-virtual-layout.ts` — the
JS-owned virtual layout described above. A merge on 2026-07-09 (`550cfe650`)
briefly and accidentally resurrected the old `content-visibility` CSS;
`7c0a3b469` (2026-07-09, "fix: preserve verified feature tree after
integration") removed it again, confirming the swap was intentional.

**The rationale for the swap is not recorded anywhere in git or docs.** The
`29e5ab67b` commit is an unmessaged squashed checkpoint with no accompanying
plan update. The closest available evidence is circumstantial:
`docs/plans/2026-07-02-002-feat-agent-panel-stress-lab-plan.md:92` frames a
25k-row stress preset as a test of whether content-visibility "needs to prove
it can handle huge DOM-flow lists," and that stress lab landed 2026-07-02 —
four days before content-visibility was removed in the same checkpoint that
added the virtualizer. That is suggestive, not confirmed: no commit, plan, or
recorded test result states that the stress lab caused the swap, or what it
found when run. For balance, note what did *not* kill content-visibility —
`docs/plans/2026-07-02-001-fix-transcript-scroll-blank-space-plan.md:110`
explicitly exonerates it ("the ballooned row measured `skip:false`; the blank
region is real empty layout, not unpainted content"), and the earlier CV
scroll-storm bug (`6a38a67a1`) was fixed, not left as an open failure.

This does not change the Decision above: Rust still sends ordered rows only,
never viewport pixels, offsets, scroll modes, spacer heights, or scrollTop
targets. Both content-visibility and the JS virtualizer that replaced it are
DOM-side mechanisms operating under that same rule — only the mechanism
changed, not the Rust/WebView authority split.

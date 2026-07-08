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
- Large transcripts rely on browser `content-visibility` and row containment
  instead of an app-owned virtual spacer.
- Any future transcript viewport feature that needs pixels must stay on the DOM
  side unless it becomes a canonical transcript fact.

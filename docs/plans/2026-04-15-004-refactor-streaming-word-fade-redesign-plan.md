---
title: "refactor: Replace streaming reveal engine with CSS word-fade animation"
type: refactor
status: active
date: 2026-04-15
origin: docs/brainstorms/2026-04-14-streaming-animation-modes-requirements.md
deepened: 2026-04-15
---

# refactor: Replace streaming reveal engine with CSS word-fade animation

## Overview

Gut the current multi-mode streaming reveal engine (smooth/classic/instant controllers, blinking cursor, budget guards, RAF-driven char pacing) and replace it with Cursor-style CSS word-fade animation: every word in newly streamed content fades from opacity 0→1 via a simple CSS animation. No cursor. No backpressure. No artificial throttling between the store update and the DOM.

## Problem Frame

The current streaming pipeline is over-engineered in ways that hurt the user experience:

1. **Mid-token rendering stops** — The `LIVE_MARKDOWN_RENDER_BUDGET_MS` guard freezes live markdown rendering after 2 consecutive 8ms+ renders, leaving text stuck mid-word with a frozen `tailText` fallback. The smooth reveal controller separately buffers tokens for 60ms before showing them. These combine to create visible "stutters" where text stops mid-token.

2. **Triple buffering** — Tokens are buffered at three layers: Rust 16ms batcher → smooth reveal 60ms `FLUSH_INTERVAL_MS` → live-markdown budget guard. The cumulative latency makes streaming feel sluggish compared to competitors.

3. **Complexity without payoff** — Three animation modes (`smooth`/`classic`/`instant`), each with its own controller, state machine, RAF loop, and CSS class strategy. The `StreamingRevealEngine` alone has 5 states (`idle`/`streaming`/`paused-awaiting-more`/`completion-catchup`/`complete`) and a 120ms pause threshold. All of this exists to pace character-by-character reveal — a pattern we're abandoning.

4. **Blinking cursor** — A `.streaming-live-cursor` with keyframe animation that appears during classic mode. The user explicitly wants this removed.

Cursor (the editor) achieves a dramatically smoother streaming feel with a fundamentally simpler approach: a rehype/AST plugin wraps each word in `<span data-sd-animate>` and CSS handles `opacity: 0→1` over 150ms. No JS reveal pacing, no cursor, no budget guards.

This plan replaces Acepe's streaming animation with an equivalent approach adapted for the markdown-it pipeline.

## Requirements Trace

- R1. Streaming text must appear with a smooth per-word fade-in animation (opacity 0→1).
- R2. The animation must apply at the word level for prose text, not character or line level. **Exceptions:** code blocks (`<pre><code>`) use block-level fade (per-word splitting inside code looks wrong), and formatted inline runs (`<strong>`, `<em>`, `<code>`, `<a>`) animate as whole units because the token-placeholder system treats them as atomic — this is acceptable since formatted runs are typically short (1-3 words). For CJK and other scripts without whitespace word boundaries, use `Intl.Segmenter` for word-level splitting where available, with whitespace-only fallback.
- R3. No blinking cursor or caret must be shown during streaming.
- R4. Already-settled content must not re-animate when new content arrives. **Scope note:** "settled" means sections that `parseStreamingTailIncremental` has promoted to the settled cache. The active live section (the one currently receiving tokens) is replaced in full via `{@html}` on each chunk update — its words will replay the 150ms CSS fade on every update. This is acceptable and by design: the fade is fast enough to be imperceptible as a "re-fade," and Cursor exhibits the same behavior (React reconciliation replaces the streaming container on each render). R4 protects content that has already been promoted to settled cache, not the actively-streaming tail.
- R5. The animation must work during live markdown rendering (paragraphs, headings, lists, code blocks).
- R6. Mid-token rendering stops must not occur — text arriving from the store must reach the DOM without artificial throttling.
- R7. Users must retain the ability to disable animation entirely (instant mode).
- R8. The animation setting must persist across app restarts.
- R9. Reduced-motion preferences must disable the animation (was previously out of scope; now trivially achievable with `prefers-reduced-motion: reduce`).

## Scope Boundaries

- No changes to the Rust 16ms streaming delta batcher (it's a reasonable network coalesce).
- No changes to SSE event transport or session update handling.
- No changes to the settled (final) markdown renderer.
- No changes to parse-streaming-tail's section splitting logic (settled/live-markdown/live-text/live-code).
- The `classic` (char-by-char typewriter) mode is being removed, not preserved.

### Deferred to Separate Tasks

- Per-token animation timing stagger (Cursor uses `animation-delay` per word index within a chunk for additional polish — this is deferred, not part of the core redesign).
- Code block syntax highlighting during streaming (remains final-render-only).

### Non-Goals

- **Cross-fade container transitions** during streaming→settled handoff. The plan uses a simple timeout-based swap. If visual flash is acceptable, no cross-fade is needed. If it's not, cross-fade is a follow-up polish task, not part of this refactor.
- **`animationend`-driven orchestration** for `isRevealActive` gating. The timeout-based approach (200ms CSS-drain) is the baseline. Animation-end detection is only warranted if empirical testing shows scroll-follow regression from timeout inaccuracy — and even then, it's a separate improvement.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/messages/logic/render-live-markdown.ts` — `renderInlineMarkdown()` is the injection point for word-wrapping in the live streaming path.
- `packages/desktop/src/lib/acp/components/messages/logic/parse-streaming-tail.ts` — settled/live section splitter. Kept as-is; it correctly identifies which content is new.
- `packages/desktop/src/lib/acp/components/messages/logic/streaming-tail-refresh.ts` — Svelte action that manages section-level CSS classes. Needs simplification.
- `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte` — the main streaming renderer. Heaviest modification target.
- `packages/ui/src/components/markdown/markdown-prose.css` — shared streaming CSS. Cursor/refresh animations replaced with word-fade.

### Institutional Learnings

- `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md` — scroll-follow must remain stable; removing the cursor and reveal engine must not break the active row's follow behavior.
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` — animation is a UI preference, not a provider policy. Keep it decoupled.

### External References

- **Cursor streaming implementation** (reverse-engineered from `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`):
  - CSS: `@keyframes sd-fadeIn { from { opacity: 0 } to { opacity: 1 } }` with `150ms ease both`
  - Plugin: rehype text-node rewriter wraps words in `<span data-sd-animate style="--sd-animation:sd-fadeIn;--sd-duration:150ms;--sd-easing:ease">`
  - Splitting: word-level by default (`sep: "word"`), whitespace preserved unwrapped
  - Batching: React `useTransition()` for non-blocking DOM updates
  - Section-level: `.chat-fade-in * { animation: fade-in .25s ease }`

## Key Technical Decisions

- **Word-level wrapping, not block or char** — Matches Cursor's approach. Word-level creates smooth per-word fade without the overhead of per-character spans or the chunkiness of block-level fades. Rationale: a paragraph arriving over 500ms with 20 words creates a natural reading-speed cascade.

- **CSS-only animation, no JS pacing** — The animation is entirely CSS `@keyframes` + `animation` property. No `requestAnimationFrame` loops, no JS timers, no artificial delay between store update and DOM. Rationale: CSS animations are compositor-threaded and cannot cause main-thread jank or "stutter" mid-token.

- **Two modes instead of three** — Keep `smooth` (word-fade, the default) and `instant` (no animation). Remove `classic` (char-by-char typewriter). Rationale: the user explicitly wants to abandon the cursor/typewriter paradigm. The classic reveal engine is the source of the mid-token bugs.

- **Inject at HTML string level, not DOM post-processing** — Word-wrapping happens during HTML generation (in `renderInlineMarkdown` for live renders), not after `{@html}` injection. Rationale: post-DOM manipulation fights Svelte's reactivity; string-level wrapping is simpler and matches Cursor's AST-level approach.

- **Formatted inline content animates as atomic units** — The token-placeholder system (`@@LIVE_MD_N@@`) replaces inline HTML (bold, italic, code spans, links) with single-token placeholders before word-splitting. After restoration, the entire `<strong>`, `<em>`, `<code>`, or `<a>` element appears as one unit. To ensure these elements fade in rather than appearing instantly, the `restoreTokenHtml` step must wrap each restored token in a `<span class="sd-word-fade">...</span>` container (when `animate: true`). This is intentional — splitting inside formatted HTML would require invasive changes and formatted runs are typically short.

- **Remove budget guards entirely** — The `LIVE_MARKDOWN_RENDER_BUDGET_MS` / `LIVE_MARKDOWN_RENDER_BREACH_LIMIT` freeze mechanism is deleted. The live markdown renderer is already cheap (regex-based, no shiki). The per-word `<span>` injection adds DOM weight but `opacity` animations are compositor-friendly and do not trigger layout reflows. The real rendering cost is Svelte's `{@html}` diff on each update — the incremental tail parser already minimizes this by caching settled sections and only updating live sections. If performance degrades on very long messages, the correct fix is to batch updates or reduce section granularity, not freeze output mid-word. Rationale: the budget guard is the primary cause of mid-token rendering stops.

  **Performance acceptance target:** Live section render (HTML generation + `{@html}` DOM update) should stay under 8ms on average and under 16ms at p95 for messages up to 5K words, measured with `performance.now()` instrumentation during Unit 5. If rendering exceeds these thresholds on long messages, record the finding and open a separate follow-up task for mitigation — do not expand this refactor's scope to include alternate rendering paths.

- **Streaming-only animation class** — Word-fade spans only appear in content rendered during active streaming via the live renderer. The settled markdown-it pipeline does **not** get a word-fade plugin. Once a message settles, the final markdown render produces clean HTML without animation wrappers. Rationale: animation is a transient streaming effect; settled content should not carry dead animation markup.

- **Explicit streaming→settled handoff** — The transition from animated live HTML to clean settled HTML is a DOM swap that could cause a visible change. The plan mitigates this by: (1) ensuring the CSS-drain timeout keeps `isRevealActive` true long enough for final animations to reach `opacity: 1`, so all animated spans are at full opacity when the settled render replaces them; (2) the settled re-render produces structurally similar HTML (same `<p>`, `<h>`, `<ul>` tags) so the visual change is minimal. If flash is observed during testing, record it as a follow-up task (see Non-Goals) rather than expanding this refactor.

## Open Questions

### Resolved During Planning

- **Should we stagger animation delay per word?** No, not in this phase. All words in a chunk animate simultaneously from opacity 0. Per-word stagger (via `animation-delay`) is deferred polish — see Deferred to Separate Tasks.

- **What about code blocks?** Live code blocks (`live-code` sections) show as `<pre><code>` with the full code text — no per-word wrapping inside code. The entire code section gets a block-level fade-in instead. Settled code blocks remain unchanged (Shiki-highlighted at final render).

- **Will removing the reveal controller break `isRevealActive` / `onRevealActivityChange`?** Yes — the current `isRevealActive` signal drives scroll-follow behavior. The replacement must still provide an `isRevealActive` signal. The controller transitions `isRevealActive` to `false` after a brief CSS-drain timeout (~200ms) once streaming ends. If scroll-follow regression appears during testing, animation-end detection can be added as a separate follow-up (see Non-Goals).

- **Should the settled (final) markdown path also get word-fade spans?** No. Word-fade animation only applies during live streaming via the custom live renderer. When the message settles, the full markdown-it render produces clean HTML without animation wrappers. This is the correct design — animation is a transient streaming effect, not a persistent DOM attribute.

### Deferred to Implementation

- Exact CSS animation duration and easing — plan targets 150ms ease (matching Cursor), but the implementer should test and adjust for Acepe's visual context.
- Whether `will-change: opacity` is needed on animated spans for GPU compositing — test on long messages first.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Store update (text grows)
    │
    ▼
markdown-text.svelte detects isStreaming + text change
    │
    ├── parseStreamingTailIncremental(text)
    │       → settled sections (cached HTML, no re-render)
    │       → live sections (re-rendered each update)
    │
    ├── Settled sections: renderLiveMarkdownSection() → HTML string
    │       (word-fade spans only for newly settled sections, not cached ones)
    │
    ├── Live sections: renderLiveMarkdownSection() → HTML with word-fade spans
    │       renderInlineMarkdown() wraps words in <span class="sd-word-fade">
    │       (no budget guard, no freeze, no tailText fallback)
    │
    └── DOM: {@html html} renders spans
            CSS: .sd-word-fade { animation: sd-fadeIn 150ms ease both }
            Already-rendered words: animation already complete, static at opacity 1

When streaming ends:
    → isStreaming becomes false
    → After brief CSS-drain timeout (~200ms), isRevealActive → false
    → Full markdown re-render replaces streaming sections with clean final HTML
    → No animation on final render (no .sd-word-fade class in settled markdown)
```

## Implementation Units

- [ ] **Unit 1: CSS word-fade animation foundation**

**Goal:** Create the CSS keyframes and utility class for word-level fade-in animation, used by the live streaming renderer.

**Requirements:** R1, R2, R9

**Dependencies:** None

**Files:**
- Modify: `packages/ui/src/components/markdown/markdown-prose.css` (add word-fade keyframes and class; remove old streaming cursor/refresh keyframes)

**Approach:**
- Add `@keyframes sd-fadeIn { from { opacity: 0 } to { opacity: 1 } }` directly in `markdown-prose.css` (which is already imported by `markdown-text.svelte` as `@acepe/ui/markdown-prose.css`). This avoids needing a new file or package export.
- Define `.sd-word-fade { animation: sd-fadeIn 150ms ease both; }` as the single animation class.
- Add `@media (prefers-reduced-motion: reduce) { .sd-word-fade { animation: none; } }` for accessibility.
- **Do NOT remove old CSS yet.** The `streaming-live-refresh` keyframe (in `markdown-prose.css`) and cursor/smooth-fade CSS (in `markdown-text.svelte` `<style>` block) are still referenced by the template and action until Units 3-5b replace them. Old CSS removal is deferred: `streaming-live-refresh` and `.streaming-section.streaming-live-refresh` are removed in Unit 4 (which rewrites the action); `streaming-live-cursor`, `.streaming-live-cursor`, `.streaming-smooth-fade`, and `smoothFadeIn` are removed in Unit 5b (which rewrites the template). This avoids a broken intermediate state where CSS classes disappear before the JS that emits them is updated.

**Patterns to follow:**
- Existing CSS in `packages/ui/src/components/markdown/markdown-prose.css` for shared markdown styling.

**Test scenarios:**
- Note: DOM-level `.sd-word-fade` span assertions belong in Unit 3 (which integrates word-wrapping into the renderer). Unit 1 is CSS-only — verify by manual QA that the keyframe and class are present in `markdown-prose.css` after editing.
- Note: CSS keyframe and `prefers-reduced-motion` rule presence is verified by manual QA, not automated test — the repo's `forbid-structural-tests.ts` guard blocks source-file inspection in unit tests

**Verification:**
- The word-fade keyframes and class are present in `markdown-prose.css` and loaded by the app via the existing import.
- Old cursor/refresh keyframes are removed from both CSS locations.

---

- [ ] **Unit 2: Word-wrapping utility for HTML string generation**

**Goal:** Create a pure function that splits text into words and wraps each in an animated `<span>`.

**Requirements:** R1, R2, R4

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src/lib/acp/components/messages/logic/wrap-words-for-animation.ts`
- Create: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/wrap-words-for-animation.vitest.ts`

**Approach:**
- Function signature: `wrapWordsForAnimation(text: string): string` — takes escaped HTML text, returns HTML with word spans.
- Split on word boundaries using `Intl.Segmenter` (with `granularity: 'word'`) when available, falling back to whitespace splitting. `Intl.Segmenter` is supported in all modern browsers and Bun/Node 16+, so the fallback is primarily a safety net. Whitespace segments are preserved as-is (not wrapped). Non-whitespace word segments get `<span class="sd-word-fade">word</span>`.
- **Critical: must be token-placeholder aware.** The live markdown renderer uses `@@LIVE_MD_N@@` placeholders to protect inline HTML tokens (code spans, links, bold, italic) from escaping. The word-wrapping function must recognize these placeholders and not split them — each placeholder should be treated as a single atomic "word" and wrapped in a `<span class="sd-word-fade">` container so the restored inline HTML fades in as a whole unit.
- The function must handle already-escaped HTML entities (`&amp;`, `&lt;`, etc.) by treating them as atomic tokens before word segmentation — similar to `@@LIVE_MD_N@@` placeholders. `Intl.Segmenter` can split `&amp;` into multiple segments; entities must be protected first and restored after wrapping.
- Must not wrap empty strings or whitespace-only input.

**Patterns to follow:**
- Cursor's `TFp` word splitter: splits on whitespace boundaries, groups consecutive whitespace, wraps non-whitespace segments.
- `Intl.Segmenter` API for Unicode-aware word boundary detection.

**Test scenarios:**
- Happy path: `"hello world"` → `<span class="sd-word-fade">hello</span> <span class="sd-word-fade">world</span>`
- Happy path: multi-word sentence preserves all whitespace positions
- Happy path: CJK text (e.g., `"こんにちは世界"`) produces per-word spans via `Intl.Segmenter` (not one giant span)
- Edge case: empty string → empty string
- Edge case: whitespace-only → whitespace unchanged
- Edge case: single word → one span
- Edge case: multiple consecutive spaces preserved between spans
- Edge case: text with newlines — newlines preserved as-is between spans
- Edge case: HTML entities (`&amp;` `&lt;`) treated as atomic tokens — not split by segmenter, pass through intact inside their word span
- Edge case: `@@LIVE_MD_N@@` placeholder tokens are wrapped in a single `.sd-word-fade` span (so restored inline HTML fades in as a whole unit)
- Edge case: mixed text and placeholders — `"hello @@LIVE_MD_0@@ world"` wraps all three tokens ("hello", placeholder, "world") each in their own `.sd-word-fade` span

**Verification:**
- All test scenarios pass.
- Function produces valid HTML for all edge cases.

---

- [ ] **Unit 3: Integrate word-fade into live markdown renderer**

**Goal:** Wire `wrapWordsForAnimation` into `renderInlineMarkdown()` and block-level renderers so live streaming content gets word-fade spans.

**Requirements:** R1, R2, R5, R6

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/logic/render-live-markdown.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/render-live-markdown.vitest.ts`

**Approach:**
- Import `wrapWordsForAnimation` and call it on text segments within `renderInlineMarkdown()`.
- The wrapping should happen after inline markdown processing (bold, italic, code, links) but on the remaining plain text segments. The token-placeholder approach already used in `renderInlineMarkdown` naturally isolates plain text from inline HTML — apply word-wrapping to the text segments during the final `escapeHtml` + `restoreTokenHtml` step.
- For code blocks (`renderPresentation` with fenced code), apply a single block-level fade class to the `<pre>` instead of per-word wrapping. Note: this only covers `settled` sections with fenced code that go through `renderLiveMarkdownSection`. Active `live-code` sections are rendered directly in `markdown-text.svelte` (as `<pre class="streaming-live-code"><code>...`), so the block-level fade class for live code blocks must be applied in the template (Unit 5), not here.
- Remove `LIVE_MARKDOWN_RENDER_BUDGET_MS` and `LIVE_MARKDOWN_RENDER_BREACH_LIMIT` exports and all budget-tracking logic.
- Accept a boolean parameter `animate: boolean` so the word-wrapping can be toggled off for instant mode and for settled sections that are already cached.

**Patterns to follow:**
- Existing `createTokenHtml` / `restoreTokenHtml` pattern in `render-live-markdown.ts`.

**Test scenarios:**
- Happy path: `renderInlineMarkdown("hello world")` with `animate: true` → contains `sd-word-fade` spans around "hello" and "world"
- Happy path: rendered paragraph contains word-fade spans in the `<p>` output
- Happy path: rendered heading contains word-fade spans in the `<hN>` output
- Happy path: rendered list items contain word-fade spans per item
- Edge case: `animate: false` → no `sd-word-fade` spans (instant mode)
- Edge case: inline code spans (`\`code\``) are not individually word-wrapped (the `<code>` block itself may get a fade, but its internal text is not split)
- Edge case: bold/italic text — the `<strong>/<em>` wrapper is inside a `.sd-word-fade` container span, fading the whole unit
- Integration: fenced code block in settled section gets block-level fade class, not per-word wrapping
- Integration: `live-code` sections rendered directly in `markdown-text.svelte` also get block-level fade class (applied in Unit 5 template changes)
- Error path: empty section text → no crash, returns valid empty/null HTML

**Verification:**
- Budget guard logic is fully removed from `render-live-markdown.ts`.
- All existing non-budget-related tests still pass.
- New animation tests pass.

---

- [ ] **Unit 4: Simplify streaming-tail-refresh to single fade strategy**

**Goal:** Replace the multi-mode section refresh action with a single strategy that works with word-fade animation.

**Requirements:** R1, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/logic/streaming-tail-refresh.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/streaming-tail-refresh.vitest.ts`

**Approach:**
- Remove all references to `StreamingAnimationMode`, `LIVE_REFRESH_CLASS`, `SMOOTH_FADE_CLASS`, and `setModeDataAttribute`.
- The refresh action now has one job: mark a section as `data-streaming-active="true"` when active, remove when inactive. This attribute can be used by CSS to scope animation behavior.
- **Backward-compatible `mode` param:** Keep `mode` in `StreamingTailRefreshParams` but mark it `@deprecated` (JSDoc) and make it optional (`mode?: StreamingAnimationMode`). The action accepts but ignores it. This avoids a TypeScript compile error in `markdown-text.svelte`, which still passes `mode` until Unit 5b removes the call site. Unit 5b deletes the parameter entirely alongside the rest of the mode-passing infrastructure.
- Remove the `requestAnimationFrame` smooth-fade restart logic.
- Remove `streaming-live-refresh` and `.streaming-section.streaming-live-refresh` from `markdown-prose.css` (deferred from Unit 1).

**Test scenarios:**
- Happy path: active section gets `data-streaming-active="true"` attribute
- Happy path: inactive section has attribute removed
- Edge case: transition from active to inactive removes attribute
- Edge case: repeated updates while active do not cause attribute thrashing

**Verification:**
- No references to old animation mode constants remain in runtime logic.
- `mode` field retained as optional deprecated param (compile-time compatibility until Unit 5b).
- Tests cover the simplified single-strategy behavior.

---

- [ ] **Unit 5a: Replace reveal controller with pass-through and delete engine files**

**Goal:** Delete the reveal engine files and replace the controller factory with a simple pass-through that provides `displayedText` and `isRevealActive` without pacing or buffering.

**Requirements:** R6

**Dependencies:** Unit 1

**Files:**
- Delete: `packages/desktop/src/lib/acp/components/messages/logic/streaming-reveal-engine.ts`
- Delete: `packages/desktop/src/lib/acp/components/messages/logic/create-streaming-reveal.svelte.ts`
- Delete: `packages/desktop/src/lib/acp/components/messages/logic/create-smooth-streaming-reveal.svelte.ts`
- Delete: `packages/desktop/src/lib/acp/components/messages/logic/grapheme-utils.ts`
- Delete: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/streaming-reveal-engine.test.ts`
- Delete: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/create-streaming-reveal.test.ts`
- Delete: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/create-smooth-streaming-reveal.test.ts`
- Rewrite: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/create-streaming-reveal-controller.test.ts` (keep file, replace with pass-through controller test scenarios)
- Modify: `packages/desktop/src/lib/acp/components/messages/logic/create-streaming-reveal-controller.svelte.ts`

**Approach:**

The reveal controller is replaced with a thin pass-through:
- `displayedText` = source text (no pacing/buffering)
- `mode` = `"streaming"` when active, `"complete"` or `"idle"` otherwise
- `isRevealActive` = `true` while streaming, then `true` for a brief CSS-drain window (~200ms) after streaming ends. **Exception:** when animation is disabled (instant mode or `prefers-reduced-motion`), skip the drain window and transition `isRevealActive` to `false` immediately.
- Reduced-motion detected via `matchMedia('(prefers-reduced-motion: reduce)')` surfaced as an internal boolean.
- The controller will need to react to mode changes mid-drain (cancel drain when mode switches to instant). **Backward-compatible creation API:** the existing `createStreamingRevealController(initialMode)` call signature is preserved in Unit 5a. The reactive mode-update mechanism (so the controller can cancel drain on mode change) is added as a new `setMode(mode)` method on the returned object, or via a writable reactive input. Unit 5b wires up the reactive mode passing at the call site when it rewrites `markdown-text.svelte` — this avoids changing both the controller API and its call site in separate units.
- Remove `RevealMode` type or collapse to a minimal union.
- Remove imports of deleted engine files.

**Execution note:** `onRevealActivityChange` fires from `markdown-text.svelte`, not from the controller — characterization tests for that callback belong in Unit 5b, not here. Unit 5a tests focus on the controller's own observable state (`displayedText`, `isRevealActive`) and its timeout/drain logic in isolation.

**Test scenarios:**
- Happy path: `displayedText` equals source text at all times (no pacing delay)
- Happy path: `isRevealActive` is `true` during streaming, transitions to `false` after CSS-drain timeout
- Edge case: rapid text growth does not cause display lag (text appears immediately)
- Edge case: streaming ends with empty text — controller returns to idle cleanly
- Edge case: instant mode skips drain timeout — `isRevealActive` transitions to `false` immediately
- Edge case: reduced-motion skips drain timeout — `isRevealActive` transitions to `false` immediately
- Edge case: mode changes to `instant` during active drain — timeout is cancelled, `isRevealActive` goes `false` immediately

**Verification:**
- All deleted files are gone from disk and no remaining imports reference them.
- Controller passes through text without pacing.
- `onRevealActivityChange` fires at correct times.

---

- [ ] **Unit 5b: Simplify markdown-text.svelte template and remove cursor**

**Goal:** Remove all cursor rendering, budget-guard logic, and mode-latching from `markdown-text.svelte`. Add block-level fade class to `live-code` sections.

**Requirements:** R3, R6, R7

**Dependencies:** Units 3, 4, 5a

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`

**Approach:**

In `markdown-text.svelte`:
- Remove `showStreamingCursor` derived and all `streaming-live-cursor` span rendering (7+ locations)
- Remove `hasLiveStreamingSection` cursor fallback block
- Remove `resolveRevealMode()` function (no mode latching needed for word-fade)
- Remove `latchedRevealModes` map and `seededRevealKeys` set
- Remove budget-guard logic (`isFrozen`, `overBudgetStreak`, `LIVE_MARKDOWN_RENDER_BUDGET_MS` usage, `tailText` fallback rendering)
- Simplify the streaming `$effect` that calls `reveal.setState` — it becomes a direct text assignment
- Simplify the live-markdown rendering `$effect` — remove freeze/budget logic, just render every section every update
- In the template, remove all `{#if showStreamingCursor && isLastSection}` branches and cursor spans
- The streaming section rendering loop stays structurally similar but without cursor insertion points
- Remove old CSS from the component's `<style>` block: `streaming-live-cursor` keyframe, `.streaming-live-cursor` styles, `.streaming-smooth-fade` keyframe, `smoothFadeIn` keyframe (deferred from Unit 1). Remove `streaming-live-refresh` rule from `markdown-prose.css` (deferred from Unit 4 if not yet done).

**`onRevealActivityChange` integration (Fix 3):** `onRevealActivityChange` is called from `markdown-text.svelte`, not the controller — start Unit 5b by writing characterization tests in `markdown-text.svelte.vitest.ts` that exercise `onRevealActivityChange` before touching the template. Verify it fires when streaming starts and when the drain window closes.

**Mode synchronization (Fix 4) — call-site cutover:** Unit 5a preserves the `createStreamingRevealController(initialMode)` creation signature and adds a `setMode(mode)` method for reactive updates. Unit 5b is the atomic cutover: call `reveal.setMode(animationMode)` wherever the component currently re-creates or patches the controller on mode change, and remove the deprecated `mode?` field from the `use:streamingTailRefresh` call. No latch needed — the controller reacts to whatever mode is currently set.

**Live code animation strategy (Fix 5):** Active `live-code` sections are replaced via `{@html}` on every chunk (same re-render issue as prose). For live code blocks, use a **fade-on-appear** approach: apply `.sd-word-fade` to the wrapper `<div>` that contains the `<pre>`, not to the `<pre>` itself. The wrapper div is stable across section identity; only its `{@html}` content changes. This means the container animates once when the section first appears, and subsequent code text updates inherit the container's opacity-1 state (animation already complete). This produces a single block-level fade-in when the code block opens, with subsequent appends appearing immediately — which is correct behavior for actively-growing code.

**Test scenarios:**
- Happy path: no `.streaming-live-cursor` elements in rendered DOM during streaming
- Happy path: `live-code` section wrapper has `.sd-word-fade` class; `<pre>` element inside does not animate again on text append
- Happy path: `onRevealActivityChange(true)` fires when streaming starts; `onRevealActivityChange(false)` fires after drain window
- Edge case: component remount during active streaming re-initializes correctly
- Edge case: mode changes from `smooth` to `instant` while streaming — drain window is skipped, `onRevealActivityChange(false)` fires immediately
- Integration: scroll-follow behavior remains stable (active row grows, viewport follows)
- Integration: streaming→settled handoff preserves content continuity (animated spans at opacity 1 replaced with clean HTML of same structure — if flash is observed, record as follow-up)
- Integration: mermaid blocks and final-only features (syntax highlighting) still render correctly at settle
- Error path: `reset()` during active streaming cleans up state without orphaned animations

**Verification:**
- No `.streaming-live-cursor` class exists in any template or CSS.
- `markdown-text.svelte` renders streaming content without any cursor element.
- Scroll-follow integration remains functional.
- `live-code` sections fade in at block level.

---

- [ ] **Unit 6: Collapse animation modes to smooth/instant and update settings**

**Goal:** Remove the `classic` mode from the type system, preferences store, settings UI, and prop-drilling chain.

**Requirements:** R7, R8

**Dependencies:** Unit 5b

**Files:**
- Modify: `packages/desktop/src/lib/acp/types/streaming-animation-mode.ts`
- Modify: `packages/desktop/src/lib/acp/store/chat-preferences-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/chat-preferences-store.vitest.ts`
- Modify: `packages/desktop/src/lib/components/settings-page/sections/chat-section.svelte`
- Modify: `packages/desktop/src/lib/components/settings-page/sections/chat-section.svelte.vitest.ts`
- Modify: `packages/desktop/src/lib/messages.ts` (remove classic-mode label/description)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Modify: `packages/desktop/src/lib/acp/components/virtual-session-list.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/content-block-router.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/acp-block-types/text-block.svelte`

**Approach:**
- In `streaming-animation-mode.ts`: remove `STREAMING_ANIMATION_MODE_CLASSIC` from the modes array and type. Update `normalizeStreamingAnimationMode` to map legacy `"classic"` and `"typewriter"` values to `"smooth"` instead of `"classic"`.
- In `chat-preferences-store.svelte.ts`: normalization handles migration automatically.
- In `chat-section.svelte`: remove the classic option from the radio group. Simplify to a toggle between smooth and instant (or keep as a two-option selector).
- In `messages.ts`: remove classic-related i18n strings.
- Across the prop-drilling chain (virtualized-entry-list → assistant-message → content-block-router → text-block → markdown-text): simplify the prop to just pass whether animation is enabled (boolean), or keep the mode type with only two values. The prop still flows to `markdown-text.svelte` which uses it to decide whether `wrapWordsForAnimation` is called.

**Test scenarios:**
- Happy path: setting saved as `"smooth"` loads as smooth mode
- Happy path: setting saved as `"instant"` loads as instant mode
- Happy path: legacy `"classic"` value normalizes to `"smooth"` on load
- Happy path: legacy `"typewriter"` value normalizes to `"smooth"` on load
- Happy path: settings UI shows exactly two options (smooth and instant)
- Edge case: unknown string value normalizes to default (`"smooth"`)
- Edge case: null/undefined value normalizes to default
- Integration: legacy `"classic"` / `"typewriter"` persisted preferences load as `"smooth"` without error (migration path tested here, not in Unit 7)

**Verification:**
- No references to `"classic"` remain in the codebase except migration normalization.
- Settings UI renders two options.
- Existing users with `"classic"` preference migrate seamlessly to `"smooth"`.

---

- [ ] **Unit 7: Integration testing and visual verification**

**Goal:** Verify the complete streaming pipeline works end-to-end without regressions.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 5b, 6

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`

**Approach:**
- Run `bun run check` to verify TypeScript compilation with all deleted files removed.
- Run `bun test` to verify all remaining tests pass.
- Add integration-level test scenarios to `markdown-text.svelte.vitest.ts` that verify:
  - Streaming text produces word-fade spans in the DOM
  - Settled (non-streaming) text does not contain word-fade spans
  - Instant mode streaming text does not contain word-fade spans
  - The transition from streaming to settled replaces animated HTML with clean final HTML

**Test scenarios:**
- Integration: streaming text contains `.sd-word-fade` spans in rendered output
- Integration: same text after streaming ends (settled) contains no `.sd-word-fade` spans
- Integration: instant mode never produces `.sd-word-fade` spans
- Integration: streaming → settled transition produces structurally similar HTML (verified by DOM snapshot comparison, not visual rendering)
- Integration: long message with many sections does not degrade (no budget freeze)
- Integration: disabled streaming links upgrade to real clickable links at settle
- Happy path: `bun run check` passes with zero type errors
- Happy path: `bun test` passes with no regressions

**Verification:**
- Zero TypeScript errors.
- All tests pass.
- No references to deleted files, old cursor classes, or budget guard constants remain in the codebase.

## System-Wide Impact

- **Scroll-follow interaction:** The `onRevealActivityChange` callback drives scroll-follow behavior. The new controller must still signal `isRevealActive` correctly — `true` during streaming, then briefly after streaming ends for CSS drain (when animation is active). When animation is disabled (instant mode or `prefers-reduced-motion`), `isRevealActive` transitions to `false` immediately when streaming ends, with no drain window. The CSS-drain gate must be validated empirically.
- **Virtual list height remeasurement:** `ResizeObserver` in the virtual list triggers remeasurement on height changes. Per-word `<span>` insertion produces more intermediate DOM nodes per update than the old plain-text path, which could increase `ResizeObserver` callback frequency. However, `opacity` animations do not change element dimensions, so height should remain stable between updates. Monitor for scroll jank on long messages.
- **Thinking block collapse:** `assistant-message.svelte` hides thinking blocks once real text starts streaming. This logic keys on `isStreaming`, not on reveal state, so it should be unaffected.
- **Virtual list rendering:** `virtualized-entry-list.svelte` only streams the last assistant entry. The `isStreaming` prop logic is unaffected by reveal engine removal.
- **Error propagation:** No error propagation changes — the streaming event path (SSE → store → component) is unchanged.
- **API surface parity:** The `@acepe/ui` package's `agent-assistant-message.svelte` and `agent-panel-layout.svelte` use `TextShimmer` for streaming placeholders, not the desktop reveal engine. No changes needed in the UI package's streaming display.
- **Unchanged invariants:** The Rust streaming delta batcher, session event service, chunk aggregator, and message processor are all unchanged. The settled markdown renderer is unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Scroll-follow breaks when `isRevealActive` timing changes | Unit 5 starts with characterization tests for scroll-follow; CSS-drain timeout preserves the signal |
| Word-fade spans add DOM weight on very long messages | Spans are only present during streaming; settled re-render strips them. Monitor DOM node count on 10K+ word messages |
| CSS animation performance on low-end hardware | `opacity` is compositor-friendly and does not trigger layout/paint. Add `will-change: opacity` only if needed |
| Users who preferred classic mode lose their setting | Legacy `"classic"` value auto-migrates to `"smooth"` which is the improved replacement. No user action needed |
| Live code blocks with per-word wrapping look wrong | Code blocks get block-level fade, not per-word — settled fenced code handled in Unit 3, `live-code` sections handled in Unit 5b |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-streaming-animation-modes-requirements.md](docs/brainstorms/2026-04-14-streaming-animation-modes-requirements.md)
- **Prior plans (superseded):** [docs/plans/2026-04-14-001-feat-streaming-animation-modes-plan.md](docs/plans/2026-04-14-001-feat-streaming-animation-modes-plan.md), [docs/plans/2026-04-15-002-feat-streaming-markdown-during-reveal-plan.md](docs/plans/2026-04-15-002-feat-streaming-markdown-during-reveal-plan.md)
- **Cursor source reference:** `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` — `sd-fadeIn` keyframes, `Bya()` animate plugin, word-splitting functions `TFp`/`AFp`, span wrapper `IFp`
- Related institutional learnings: `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md`, `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`

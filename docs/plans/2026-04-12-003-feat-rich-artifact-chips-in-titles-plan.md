---
title: "feat: Render artifact chips in session and kanban titles"
type: feat
status: active
date: 2026-04-12
---

# feat: Render artifact chips in session and kanban titles

## Overview

Session titles can contain inline artifact tokens (`@[file:path]`, `@[image:path]`, `@[text:base64]`). Currently these are stripped by `stripArtifactsFromTitle()` before display, losing useful context. This plan renders them as visual chips using the existing `InlineArtefactBadge` component, in both the session list sidebar and kanban card titles.

## Problem Frame

When a user starts a session by pasting a screenshot, attaching files, or pasting text, that context is embedded in the session title as `@[type:value]` tokens. The current stripping hides what the session was about. Rendering these as chips gives immediate visual context about what artifacts were involved.

## Requirements Trace

- R1. Chips render in their natural position within the title string (interspersed with text)
- R2. Artifact-only titles (no text content, only tokens) show chips instead of falling back to "Conversation in Project"
- R3. Use existing `InlineArtefactBadge` as-is (already renders with `density="inline"` internally)
- R4. Applies to session list items (`session-item.svelte`) and kanban cards (`kanban-card.svelte`)
- R5. XML tags (`<ide_opened_file>`, `<system-reminder>`, etc.) are still stripped — only `@[type:value]` tokens become chips

## Scope Boundaries

- No changes to how titles are stored or derived — only display-time rendering
- No new chip density or sizing variants
- No click behavior on chips in titles (chips are non-interactive in this context)
- Token rendering in other surfaces (tab bar, window title, etc.) is out of scope

## Context & Research

### Relevant Code and Patterns

- `packages/ui/src/components/rich-token-text/rich-token-text.svelte` — already tokenizes text and renders `InlineArtefactBadge` chips mixed with text spans. Used in `agent-user-message.svelte`
- `packages/ui/src/lib/inline-artefact/inline-artefact-segments.ts` — `tokenizeInlineArtefacts(text)` parses `@[type:value]` tokens into typed segments
- `packages/ui/src/components/inline-artefact-badge/` — renders a single token as a chip with icon + label
- `packages/desktop/src/lib/acp/store/session-title-policy.ts` — `stripArtifactsFromTitle()` strips both XML tags and `@[type:value]` tokens
- `packages/ui/src/components/attention-queue/attention-queue-entry.svelte` (`ActivityEntry`) — accepts optional `titleContent` snippet, already used by session-item for custom title rendering
- Svelte 5 snippet props must be defined unconditionally (see `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md`)

### Institutional Learnings

- Artifact stripping regex uses lookahead patterns for malformed closing tags (MEMORY.md)
- `InlineArtefactBadge` renders as `inline-flex` within `ChipShell` — works naturally with inline text flow and CSS truncation

## Key Technical Decisions

- **Reuse `RichTokenText` (modified)** rather than duplicating segment rendering: The component already handles tokenization + badge rendering. It needs a minor change to support title-context styling (currently hardcodes `text-sm leading-relaxed`; titles need `text-xs`). Adding a `textClass` prop with the current value as default preserves backward compatibility.

- **New `stripXmlArtifactsFromTitle()` function** for title-display use: The existing `stripArtifactsFromTitle()` strips everything (XML + tokens + expanded refs). We need a variant that strips only XML tags and expanded refs (`[Attached image: ...]`), preserving `@[type:value]` tokens for chip rendering.

- **Pass raw title to kanban card via new `richTitle` field**: `KanbanCardData.title` continues to hold the clean display title (used for tooltip, accessibility). A new `richTitle: string | null` field carries the token-preserved title for rendering. When `richTitle` is present, the kanban card renders via `RichTokenText`; otherwise plain text.

- **Fallback logic change**: A title with only tokens (no text) is currently treated as empty → fallback to "Conversation in Project". The new behavior: if `stripXmlArtifactsFromTitle()` produces content (even if it's only tokens), it's not a fallback — render the chips. Only truly empty titles get the fallback.

## Open Questions

### Resolved During Planning

- **Where does the new stripping function live?** In `session-title-policy.ts` alongside the existing functions — it's the same concern (title normalization for display), just a different output format.
- **Does kanban-card need a snippet prop?** No. Passing `richTitle` as a string and having the card use `RichTokenText` internally is simpler and keeps the card self-contained within `@acepe/ui`.

### Deferred to Implementation

None — all open questions resolved during planning.

## Implementation Units

- [ ] **Unit 1: Add `stripXmlArtifactsFromTitle()` to session-title-policy**

  **Goal:** Create a title normalization function that preserves `@[type:value]` tokens while stripping XML tags and expanded refs.

  **Requirements:** R2, R5

  **Dependencies:** None

  **Files:**
  - Modify: `packages/desktop/src/lib/acp/store/session-title-policy.ts`
  - Test: `packages/desktop/src/lib/acp/store/__tests__/session-title-policy.vitest.ts`

  **Approach:**
  - Extract the XML tag stripping regex and expanded-ref stripping into `stripXmlArtifactsFromTitle(title)`. This function applies the XML tag pattern and `[Attached ...]` pattern but skips the `@[type:value]` token pattern.
  - Also normalize newlines (same as `normalizeTitleForDisplay` does).
  - Add `formatRichSessionTitle(title, projectName)` that returns `{ richText: string | null; plainText: string }`. `richText` is the token-preserved title (from `stripXmlArtifactsFromTitle`) when it contains tokens; `null` when there are no tokens. `plainText` is the existing `formatSessionTitleForDisplay` result for tooltip/fallback.
  - For fallback logic: if `stripXmlArtifactsFromTitle` produces non-empty content (even if it's all tokens), `richText` is non-null.

  **Patterns to follow:**
  - Existing `stripArtifactsFromTitle()` — same regex patterns, just selective application
  - `normalizeTitleForDisplay()` — newline collapsing pattern

  **Test scenarios:**
  - Happy path: title with XML tags + tokens → XML stripped, tokens preserved (`"<ide_opened_file>File</ide_opened_file>@[image:/screenshot.png] Fix bug"` → `"@[image:/screenshot.png] Fix bug"`)
  - Happy path: title with only tokens → tokens preserved (`"@[image:/a.png] @[file:/b.ts]"` → `"@[image:/a.png] @[file:/b.ts]"`)
  - Happy path: title with no artifacts → unchanged (`"Simple title"` → `"Simple title"`)
  - Edge case: expanded refs stripped but tokens kept (`"[Attached image: /a.png] @[file:/b.ts] Fix"` → `"@[file:/b.ts] Fix"`)
  - Edge case: title with only XML tags, no tokens → empty string
  - Happy path: `formatRichSessionTitle` with tokens → `richText` non-null
  - Happy path: `formatRichSessionTitle` with no tokens → `richText` null
  - Happy path: `formatRichSessionTitle` with token-only title → `richText` non-null, `plainText` is fallback
  - Edge case: newline normalization applied to rich title (`"@[file:/a.ts]\nFix bug"` → `"@[file:/a.ts] Fix bug"`)

  **Verification:**
  - All existing `session-title-policy` tests still pass (no regressions in `stripArtifactsFromTitle` or `formatSessionTitleForDisplay`)
  - New tests pass for `stripXmlArtifactsFromTitle` and `formatRichSessionTitle`

- [ ] **Unit 2: Make `RichTokenText` styling flexible**

  **Goal:** Allow `RichTokenText` to work in title contexts (text-xs) without breaking existing message contexts (text-sm).

  **Requirements:** R3, R4

  **Dependencies:** None (can run in parallel with Unit 1)

  **Files:**
  - Modify: `packages/ui/src/components/rich-token-text/rich-token-text.svelte`

  **Approach:**
  - Add a `textClass` prop with default `"text-sm leading-relaxed"` (current hardcoded value).
  - Replace the hardcoded classes in the wrapper `<span>` with `{textClass}`.
  - Existing consumers pass no `textClass` → get current behavior unchanged.
  - Title consumers pass `textClass="text-xs font-medium"` or similar.

  **Patterns to follow:**
  - Same prop-with-default pattern used throughout `@acepe/ui` components (e.g., `ChipShell` density prop)

  **Test scenarios:**
  - Test expectation: none — pure styling change with no behavioral logic. Verified visually.

  **Verification:**
  - Existing `RichTokenText` usage in `agent-user-message.svelte` renders identically (no visual regression)
  - `bun run check` passes

- [ ] **Unit 3: Render rich titles in session-item**

  **Goal:** Session list items render artifact tokens as inline chips instead of stripping them.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** Unit 1, Unit 2

  **Files:**
  - Modify: `packages/desktop/src/lib/components/ui/session-item/session-item.svelte`

  **Approach:**
  - Import `formatRichSessionTitle` alongside the existing `formatSessionTitleForDisplay`.
  - Import `RichTokenText` from `@acepe/ui`.
  - Compute both `richTitle` and `displayTitle` from the raw `session.title`.
  - In the `titleContent` snippet: when `richTitle` is non-null, render via `RichTokenText` with `textClass="text-xs font-medium"` and `class="truncate block"`. Otherwise keep existing plain text rendering.
  - Keep `displayTitle` for the tooltip (`title` attribute) and rename editor prefill.
  - For the `ActivityEntry` `title` prop (used for accessibility/fallback), continue passing `displayTitle`.

  **Patterns to follow:**
  - Existing `titleContent` snippet pattern in session-item (lines 664-681)
  - Svelte 5 unconditional snippet definition pattern (snippet always defined, condition inside body)

  **Test scenarios:**
  - Happy path: session with `@[file:/app.ts] Fix auth` title → chip + text rendered in sidebar
  - Happy path: session with `@[image:/screenshot.png]` only → chip rendered, no "Conversation in" fallback
  - Happy path: session with plain text title → no change in behavior
  - Edge case: session with XML tags + tokens → XML stripped, tokens rendered as chips
  - Integration: rename editor still prefills with clean `displayTitle`, not raw token text

  **Verification:**
  - Session list items with artifact tokens display chips inline
  - Session list items without tokens display unchanged
  - Tooltip shows clean text, not raw tokens
  - `bun run check` passes

- [ ] **Unit 4: Render rich titles in kanban cards**

  **Goal:** Kanban cards render artifact tokens as inline chips.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** Unit 1, Unit 2

  **Files:**
  - Modify: `packages/ui/src/components/kanban/types.ts`
  - Modify: `packages/ui/src/components/kanban/kanban-card.svelte`
  - Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`

  **Approach:**
  - Add `richTitle?: string | null` to `KanbanCardData` in types.ts.
  - In `kanban-view.svelte:mapItemToCard()`: use `formatRichSessionTitle(item.title, item.projectName)` to compute both `title` (plain) and `richTitle` (token-preserved). Pass both to the card data.
  - In `kanban-card.svelte`: when `card.richTitle` is truthy, render via `RichTokenText` with `textClass="text-xs font-medium leading-tight"`. Otherwise keep existing plain `{title}` rendering.
  - Keep `title` for tooltip via the parent `div`'s `title` attribute.

  **Patterns to follow:**
  - Existing kanban card title rendering (lines 127-131)
  - `RichTokenText` usage from Unit 3

  **Test scenarios:**
  - Happy path: kanban card with `richTitle` containing tokens → chips rendered in title area
  - Happy path: kanban card with `richTitle` null → plain text title unchanged
  - Happy path: kanban card with token-only `richTitle` → chips rendered, no "Untitled conversation" fallback
  - Edge case: long title with chips → chips + text truncated gracefully within the title container

  **Verification:**
  - Kanban cards with artifact tokens display chips
  - Kanban cards without tokens display unchanged
  - `bun run check` passes

## System-Wide Impact

- **Interaction graph:** `formatRichSessionTitle` is a new export from session-title-policy. It is consumed by session-item.svelte and kanban-view.svelte. No callbacks or middleware affected.
- **Error propagation:** `tokenizeInlineArtefacts` uses `Result.fromThrowable` for base64 decoding — already handles decode failures gracefully (returns "Pasted text" label).
- **State lifecycle risks:** None — purely display-time transformation, no state mutations.
- **API surface parity:** The `AppSessionItem` component (`packages/ui/src/components/app-layout/app-session-item.svelte`) also renders session titles but is not in scope. If it needs rich titles later, the same pattern applies.
- **Unchanged invariants:** `stripArtifactsFromTitle`, `formatSessionTitleForDisplay`, `normalizeTitleForDisplay` — all existing functions remain unchanged and continue to work for callers that need fully-stripped titles (title derivation, fallback detection, etc.).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Chips may overflow tight title containers on narrow sidebars | `truncate` on the wrapper clips overflow naturally; chips render as inline-flex so they participate in text flow |
| `RichTokenText` `textClass` prop may not cleanly override Tailwind defaults | Default is extracted from current hardcoded value; title callers pass explicit class. Verify during implementation. |
| Renaming sessions may include token syntax if prefilled from rich title | Session-item already uses `displayTitle` (plain) for rename editor prefill — no change needed |

## Review Notes (2026-04-12)

- **Capitalization**: Apply `capitalizeTitle()` to `richText` output, targeting first non-token text character
- **Class prop**: Use `cn()` with existing `class` prop instead of adding `textClass` — avoids two-class-prop confusion
- **R2 scope**: R2 is display-time only. If `getTitleUpdateFromUserMessage` already replaced tokens, that's expected
- **Truncation**: Accept mid-chip clipping as v1. Don't include `break-words` in title context
- **Chip sizing**: If chips look oversized in `text-xs` context, visual tuning is a follow-up

## Sources & References

- Related code: `packages/ui/src/components/rich-token-text/rich-token-text.svelte`
- Related code: `packages/ui/src/lib/inline-artefact/inline-artefact-segments.ts`
- Related code: `packages/desktop/src/lib/acp/store/session-title-policy.ts`
- Related learning: `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md`

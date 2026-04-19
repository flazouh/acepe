# Agent Panel Header Title — Hover Expansion

**Date:** 2026-04-19
**Status:** Draft
**Scope:** Lightweight — UI-only change inside `@acepe/ui` agent-panel + desktop model mapping.

## Problem

The agent panel currently shows its session title in a **dedicated sub-row below** `EmbeddedPanelHeader`. The sub-row takes permanent vertical space even though the title is rarely the active reading target once a session is underway. Meta chips (subtitle, agent label, branch, badges) live there too and clutter the panel in a steady-state view.

## Goal

1. Put the session title back **inside** `EmbeddedPanelHeader` (same row as status dot and action buttons).
2. Remove the dedicated sub-row below the header in its current always-visible form.
3. On hover (or keyboard focus) of the header, **animate in a sub-row** that shows the full title plus chips describing what started the thread: file attachments and image/screenshot attachments from the **first user message**.
4. Reclaim vertical space in the default state while keeping the richer context one interaction away.

## Users & Value

- **Single user persona:** someone running an agent session in Acepe.
- **Value:** more vertical room for transcript; richer context available on intent (hover/focus) without permanent chrome.

## Scope

### In scope

- Inline title inside `EmbeddedPanelHeader` via the existing `HeaderTitleCell` slot.
  - Source: `displayTitle ?? sessionTitle ?? "New thread"`.
  - Truncated with ellipsis; native `title` attribute for the truncated case.
  - Status dot continues to render next to it (keep today's placement semantics).
- Remove the existing always-visible sub-row (the `<div>` with `border-b border-border/50 px-3 py-1.5` containing the title `<p>` and the `showMetaRow` chips).
- Add a new **hover/focus-within expansion panel** directly underneath the header with:
  - Full (non-truncated) title text.
  - Chips for first-user-message attachments:
    - File chips — one per `resource_link` block on the first user `SessionEntry`.
    - Image/screenshot chips — one per `image` block on the first user `SessionEntry`.
  - Visual parity with composer chips (reuse `agent-input-artefact-badge.svelte` or an equivalent presentational chip).
- Hover target: **the whole header row** (`EmbeddedPanelHeader`). Expansion stays open while the pointer is over either the header or the expanded panel, and when any descendant has focus (`:hover` or `:focus-within`).
- Animation: expand-height + fade, ~150 ms, respecting `prefers-reduced-motion` (snap open/close under reduced motion).
- Empty states:
  - No first user message yet → show only the full title, no chips row.
  - First user message has zero file/image attachments → show only the full title, no chips row.

### Non-goals

- **Pasted-text chips** are out of scope. Once a message is submitted, pasted text is inlined into the text block; reconstructing "this was a paste" requires new provenance metadata at submit time. Track as a follow-up if desired.
- No change to the composer’s own chip rendering.
- No change to keyboard shortcuts, the close/fullscreen actions, agent icon, project badge, or dropdown/controls slots.
- No change to the `pendingProjectSelection` branch of the header.
- No persistence of "expanded" state across sessions — ephemeral hover/focus only.
- No click-to-pin behavior in this iteration.

## UX Behavior

### Default (no hover, no focus-within)
- `EmbeddedPanelHeader` shows: project badge (if any) → agent icon / leading control → status dot + **title** → action cells.
- Nothing rendered below the header.

### Hover or focus-within on header
- Expansion panel animates in directly below the header.
- Contents (top to bottom):
  - Full title, wrapping allowed (bounded max-height with scroll, mirroring the current sub-row’s `max-h-9 overflow-y-auto`).
  - Chip row: files + images from the first user message, in that order, horizontally wrapping.
- Panel closes on pointer leave of both the header and the panel, and when focus leaves the region.

### Animation
- Expand/collapse: height auto-animation + opacity fade, ~150 ms, standard ease. Use existing `@acepe/ui` motion primitives if any; otherwise a small, colocated transition. No layout shift for in-panel content below.
- `prefers-reduced-motion: reduce` → no transition; panel appears/disappears instantly.

### Accessibility
- Region uses `role="region"` with an `aria-label` (e.g., "Session context").
- Expansion triggers on both hover and keyboard focus-within, so keyboard users can reach chips via Tab.
- Chips are buttons/links matching composer chip semantics (no new interactive behavior required in this iteration — they can be non-interactive spans if the composer’s chips are; match existing behavior).
- Title inside the header has `title={fullTitle}` when truncated, so hover tooltip still gives full text even before expansion animates.

## Data / Model Changes

- `AgentPanelHeaderProps` (in `@acepe/ui`) gains an optional `firstMessageAttachments: readonly { id: string; kind: "file" | "image"; label: string; detail?: string | null }[]` (or reuse `AgentPanelComposerAttachment` shape; decision belongs to planning).
- Desktop model mapping in `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts` extracts first-user-message attachments from `SessionEntry.message.chunks`:
  - `resource_link` → file chip (`label = name`, `detail = uri` or size).
  - `image` → image chip (`label = "Image"` or inferred filename, `detail = mimeType`).
- Remove the `showMetaRow` + current sub-row props (`subtitle`, `agentLabel`, `branchLabel`, `badges`) **or** repurpose them inside the new expansion panel if they’re still used elsewhere. Planning decides; default preference is to remove entirely from this header and let planning confirm no other consumer depends on them.

## Success Criteria

- Panel is visibly shorter in default state (no sub-row).
- Hover/focus on the header reveals the expansion panel with title + chips; leaving collapses it.
- Animation respects `prefers-reduced-motion`.
- First-user-message with files/images produces correct chips in Storybook/mock render.
- First-user-message absent or empty produces no chip row, only the full title.
- No regression to existing tests in:
  - `packages/ui/src/components/agent-panel/__tests__/` (notably `agent-panel-header` / `agent-panel-leaf-widgets`).
  - `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-header.project-style.svelte.vitest.ts`.
- `bun run check` passes.

## Risks / Open Questions

- **Other consumers of the removed sub-row props** (`subtitle`, `agentLabel`, `branchLabel`, `badges`): planning must verify nothing else in `@acepe/ui` or `packages/website` mock demos expects them to render here. If it does, either keep rendering them inside the expansion panel or move to a different surface.
- **Chip reuse** — `agent-input-artefact-badge.svelte` may have composer-specific styling. If not directly reusable, extract a smaller presentational chip or add a variant.
- **Hover flicker on the gap** between header and expansion panel — the expansion must be rendered as a single hover region with the header (e.g., wrapping both in a shared container with `:hover`, or using `:focus-within` + pointer-events management). Planning to specify.
- **Fullscreen / very narrow panel widths** — chips should wrap; the full title should remain readable. Confirm against min panel width used in existing layout tests.

## Follow-ups (explicit non-goals)

- Pasted-text provenance chip (requires new metadata at submit time).
- Click-to-pin expansion.
- Showing meta chips (subtitle/agentLabel/branchLabel/badges) inside the expansion panel if they’re still valuable — revisit after this lands.

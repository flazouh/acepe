---
title: "fix: Match project header button sizing to the compact sidebar footer"
type: fix
status: active
date: 2026-04-14
---

# fix: Match project header button sizing to the compact sidebar footer

## Overview

Bring the desktop sidebar's per-project header actions down to the same compact visual scale as the bottom-left social footer controls. This keeps the sidebar chrome visually consistent after the footer buttons were reduced.

## Problem Frame

The sidebar footer now uses a tighter 20px button shell, smaller icons, and reduced spacing, but the project header controls still render with 24px shells and wider action rails. That leaves the project cards visually heavier than the footer despite living in the same compact sidebar surface. The request is narrow and implementation-ready, so a lightweight fix plan is sufficient without a separate requirements document.

## Requirements Trace

- R1. Project header action buttons use the same compact shell size as the bottom-left sidebar footer buttons.
- R2. Inner icon sizes and surrounding spacing are reduced proportionally so the controls still read clearly.
- R3. Both duplicated project-header render paths stay visually in sync.
- R4. Existing interactions remain unchanged: new-session, fetch, and source-control actions keep their current handlers, tooltip text, and disabled states.

## Scope Boundaries

- No further changes to `packages/desktop/src/lib/components/main-app-view/components/sidebar/sidebar-footer.svelte`
- No changes to top-bar buttons, website social links, or footer version text
- No changes to project-header agent-strip buttons
- No behavior changes to session creation, fetch, or source-control flows

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/components/main-app-view/components/sidebar/sidebar-footer.svelte` is the new compact reference: 20px shells (`size-5`), tighter gaps, and smaller icon sizes.
- `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte` renders the project header action buttons directly:
  - one create-session button in the first `ProjectHeader` branch
  - one create-session button in the second `ProjectHeader` branch
  - the expanded git-action rail for fetch and source control
- `packages/desktop/src/lib/acp/components/project-header.svelte` owns the shared action-slot wrapper spacing (`gap-0.5`, `pr-0.5`) for the right edge of project headers.
- Existing tests under `packages/desktop/src/lib/acp/components/session-list/__tests__/` cover session-list logic and hierarchy, but there is no current UI-focused regression test for these header control sizes.

### Institutional Learnings

- No directly relevant `docs/solutions/` entry was found for sidebar micro-action sizing or header/footer parity.

### External References

- None. The codebase already has the local sizing reference needed for this fix.

## Key Technical Decisions

- **Use the compact footer as the visual source of truth:** The footer already reflects the desired density, so the project-header controls should match that shell size and spacing rather than inventing a second compact scale.
- **Treat the duplicated session-list render paths as one surface:** Both create-session buttons must be updated together so expanded and alternate project-card branches cannot drift.
- **Tighten spacing at both levels:** The fix should cover the concrete button shells in `session-list-ui.svelte` and the shared action-rail spacing in `project-header.svelte` if needed for true parity, rather than only shrinking icons inside oversized containers.

## Open Questions

### Resolved During Planning

- **Which buttons count as "project header buttons"?** The per-project create-session plus button in both `ProjectHeader` render paths, plus the expanded fetch and source-control buttons in the project header action rail.
- **Should the footer be changed again?** No. The footer is already the target reference.

### Deferred to Implementation

- **Exact icon-size balance for each header action:** The shell size should match the footer, but the final plus/fetch/git icon sizes may need a small visual adjustment during implementation so each glyph remains centered and legible within the smaller shell.

## Implementation Units

- [ ] **Unit 1: Tighten the shared project-header action rail**

**Goal:** Make the project header's shared action-slot spacing match the tighter compact treatment so the right edge of each header does not retain extra padding after the button shells shrink.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/project-header.svelte`

**Approach:**
- Review the `actions` slot wrapper spacing in `ProjectHeader` and reduce any remaining right-edge padding or inter-button spacing that keeps the compact buttons from visually matching the footer density.
- Preserve the existing separation between the project-title area and the action rail so shrinking the controls does not crowd the caret, trailing controls, or project name.

**Patterns to follow:**
- `packages/desktop/src/lib/components/main-app-view/components/sidebar/sidebar-footer.svelte`
- Existing `ProjectHeader` slot layout in `packages/desktop/src/lib/acp/components/project-header.svelte`

**Test scenarios:**
- Test expectation: none -- styling-only spacing adjustment in a shared wrapper with no behavior change.

**Verification:**
- The project-header action rail no longer looks roomier than the compact footer row when both are visible in the sidebar.

- [ ] **Unit 2: Shrink the project-header action buttons in both session-list render paths**

**Goal:** Apply the compact footer sizing to every concrete project-header action button so the create-session, fetch, and source-control controls all use the same reduced shell and icon scale.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte`

**Approach:**
- Replace the 24px button shells used by the duplicated create-session buttons with compact shells that match the footer treatment.
- Update the expanded git-action rail (`Fetch remote`, `Source Control`) to the same shell size and proportionally smaller icons.
- Keep both `ProjectHeader` branches aligned by reusing the same sizing treatment in both duplicated create-button sections instead of adjusting only one branch.
- Tighten any local rail spacing around the expanded git buttons if the smaller shells otherwise leave footer/header density mismatched.

**Execution note:** Keep this behavior-preserving. The change is visual only; handler wiring, tooltips, and disabled states should remain untouched.

**Patterns to follow:**
- `packages/desktop/src/lib/components/main-app-view/components/sidebar/sidebar-footer.svelte`
- Existing project action render sites in `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte`

**Test scenarios:**
- Test expectation: none -- styling-only size alignment with no behavior or state change.

**Verification:**
- Both create-session buttons render at the compact size in both project-header branches.
- Expanded fetch and source-control buttons match the compact size and still align cleanly with the project header content.
- Tooltips, click handlers, and disabled fetch styling continue to behave exactly as before.

## System-Wide Impact

- **Interaction graph:** No new callbacks or state paths. Existing `handleCreateClick`, `handleFetchRemote`, and `handleOpenGitPanel` flows remain as-is.
- **Error propagation:** None; this change does not alter data flow or async handling.
- **State lifecycle risks:** The two duplicated create-button render sites can drift if only one is updated. The expanded git-action rail can also keep old density if it is treated separately.
- **API surface parity:** Only the desktop sidebar project header is in scope; other header-action surfaces are explicitly unchanged.
- **Integration coverage:** Visual parity needs to be checked across both project-header branches and the expanded git-header state.
- **Unchanged invariants:** Project expand/collapse behavior, tooltips, disabled fetch treatment, and source-control opening remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| One duplicated `ProjectHeader` branch keeps the old button size | Treat both create-button render paths as part of the same implementation unit and verify both visually |
| Smaller shells make one icon feel undersized or off-center | Lock the shell size first, then tune the plus/fetch/git icon sizes together during implementation |
| Tightening spacing crowds the project title or caret | Keep spacing changes scoped to the action rail and verify the header still truncates cleanly |

## Documentation / Operational Notes

- No documentation or operational updates are expected for this styling-only fix.

## Sources & References

- Related code: `packages/desktop/src/lib/components/main-app-view/components/sidebar/sidebar-footer.svelte`
- Related code: `packages/desktop/src/lib/acp/components/project-header.svelte`
- Related code: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte`
- Related plan: `docs/plans/2026-04-13-001-feat-sidebar-project-management-plan.md`

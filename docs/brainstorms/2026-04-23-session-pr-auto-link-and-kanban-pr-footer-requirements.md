---
date: 2026-04-23
topic: session-pr-auto-link-and-kanban-pr-footer
---

# Session PR Auto-Linking and Kanban PR Footer

## Problem Frame

Acepe already supports linking a pull request to a session and opening the Source Control PR view from session UI. The remaining gap is consistency: sessions that clearly create or open a PR should link automatically, and the kanban view should show the same linked PR state instead of relying on separate mention-based UI behavior.

## Requirements

**Session PR attribution**
- R1. Acepe must support automatic PR linking for a session when the same session produces a verified PR create/open signal.
- R2. Auto-linking must use a balanced policy: a candidate PR only qualifies when the session performs an explicit PR-oriented create/open action and the confirmed result includes a concrete PR URL or PR number for the current repo.
- R3. A passive PR mention, rendered PR badge, markdown shorthand, prose reference, or other mention-only content must never automatically assign a PR to a session.
- R4. Auto-linking must only accept PRs that belong to the session's current project repository.
- R5. If a session produces multiple valid auto-link candidates over time and the user has not manually overridden the link, the latest valid PR must replace the previous linked PR.
- R6. Users must be able to manually override the linked PR from a session-level dropdown control, including after an automatic link has already been assigned.
- R7. A manual override must lock the linked PR until the user changes it again; later automatic signals must not replace a manually overridden link.
- R8. Existing manual linking behavior must remain available as a fallback when no valid automatic signal exists.

**Shared UI behavior**
- R9. The sidebar, session surfaces, and kanban surfaces must all read from the same persisted session PR link rather than maintaining separate PR-detection rules.
- R10. The kanban card must show a PR footer only when the session has a linked PR through that shared mechanism.
- R11. The kanban PR footer must open the Source Control PR panel when the main footer area is clicked.
- R12. The kanban PR footer must include a separate GitHub action control that opens the linked PR externally without changing the main footer click behavior or propagating to the main footer handler.

**PR presentation**
- R13. The kanban PR footer must display PR-based diff stats, not the session's local diff tally.
- R14. When the kanban PR footer is present, the existing git diff display in the kanban card header must be removed so the PR summary has a single canonical location.

## Success Criteria
- Sessions that explicitly create or open a PR for the current repo become linked without requiring the user to click the PR badge first.
- Passive PR mentions do not create false session-to-PR links.
- Users can override the linked PR from a dropdown when the automatic link is wrong or no longer the one they want.
- A manual override keeps the chosen PR linked until the user changes it again.
- Sidebar and kanban show the same linked PR for the same session.
- Clicking the kanban footer opens the Source Control PR panel for that linked PR, while the GitHub action opens the external PR page.
- PR diff stats shown in kanban match the linked PR rather than the local working diff.

## Scope Boundaries
- Out of scope: linking sessions to PRs from other repositories automatically.
- Out of scope: showing PR footer UI for unlinked PR mentions.
- Out of scope: supporting multiple simultaneous linked PRs per session.
- Out of scope: changing the existing manual PR-link fallback beyond keeping it available.

## Key Decisions
- Balanced auto-linking: auto-link only from explicit create/open actions paired with verified PR result data from the current repo; do not link from passive mentions.
- Latest valid PR wins only while the link remains automatic; a manual override locks the chosen PR until the user changes it again.
- Users can manually override the linked PR from a dropdown when they need to correct or replace the current link.
- Same mechanism everywhere: kanban uses the same persisted session PR link as the sidebar and other session surfaces.
- Footer is the primary PR surface in kanban: the footer owns PR summary, PR diff stats, and Source Control navigation; the header diff is removed when this footer exists.

## Dependencies / Assumptions
- The session model already persists a single linked PR number and existing UI can open the Source Control panel to a specific PR.
- PR detail data needed for status and diff stats can be fetched for a linked PR in the current repo.

## Outstanding Questions

### Resolve Before Planning
- None.

### Deferred to Planning
- [Affects R1, R2][Technical] Define the exact session signals that count as verified create/open outcomes across existing ship flows, execute-tool results, and any supported GitHub tool surfaces.
- [Affects R9, R10, R13, R14][Technical] Decide the cleanest projection path for carrying linked PR number, PR state, and PR diff stats into kanban card data without introducing a separate detection path.
- [Affects R13][Needs research] Decide cache and refresh behavior for PR detail fetching so kanban footer stats stay responsive without redundant requests.

## Next Steps
-> /ce:plan for structured implementation planning

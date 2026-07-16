---
date: 2026-04-05
topic: session-project-sequence-id
---

# Per-Project Session Sequence IDs

## Problem Frame

When multiple sessions exist for the same project, there's no quick way to reference a specific one. Sessions use UUIDs internally and display titles that can be similar or auto-generated. Users need a short, stable identifier — like `#3` — to quickly distinguish and reference sessions within a project context.

## Requirements

**ID Assignment**
- R1. Each Acepe-native session receives a persistent, monotonically increasing integer ID scoped to its project (e.g., `#1`, `#2`, `#3`)
- R2. IDs are assigned at session creation time, only to natively-created sessions. The `SessionLifecycleState::Created` state at creation time is the reliable indicator. Once assigned, the ID persists regardless of later lifecycle transitions (e.g., session acquiring a transcript file). Scanned/discovered sessions never receive an ID
- R3. IDs are never reused or reassigned within a project, even if earlier sessions are deleted
- R4. The next ID for a project is always `MAX(existing IDs for that project) + 1`

**Backfill**
- R5. On first launch after the feature ships, a one-time migration assigns IDs to all existing native sessions, ordered by `createdAt` within each project
- R6. Scanned sessions are skipped during backfill — they get no sequence ID

**Display**
- R7. The sequence ID appears as `#N` immediately to the right of the project letter badge, forming a combined project identifier (e.g., `[A] #3`)
- R8. The `#N` is shown everywhere the project badge appears: kanban cards, session list, session header
- R9. Scanned sessions that have no sequence ID show only the project badge with no `#N` suffix

## Success Criteria

- A user can glance at any kanban card and immediately identify which session it is by project + number
- The same `#N` identifier is consistent across all views (kanban, list, header)
- IDs remain stable across app restarts, session closures, and deletions
- Existing native sessions receive correct IDs on first launch after update
- Scanned/discovered sessions display normally with project badge only — no `#N` shown

## Scope Boundaries

- IDs are display-only — not used for routing, URLs, or API references
- No search-by-ID or jump-to-ID functionality in this scope
- No user-facing ability to rename or override the sequence number
- Scanned/imported sessions are explicitly excluded from numbering

## Key Decisions

- **Persistent over ephemeral**: IDs are permanent per session, not re-numbered when the board changes. Enables stable verbal references ("check #12")
- **Native-only**: Only sessions created in Acepe get IDs. Leverages existing `SessionLifecycleState` distinction — no new origin tracking needed
- **Backfill by creation order**: Existing native sessions get retroactive IDs sorted by `createdAt`. Consistent experience from day one
- **Right of badge placement**: `[A] #3` keeps the project badge as the visual anchor and adds the ID as a lightweight suffix

## Dependencies / Assumptions

- `SessionLifecycleState` reliably distinguishes native vs. scanned sessions (verified: computed from `file_path`, `file_mtime`, `file_size` in `repository.rs`)
- `createdAt` timestamps on existing native sessions are accurate enough for correct ordering during backfill

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R4][Technical] Should the sequence counter live as a new column on `session_metadata` or in a separate `project_sequence` table? Tradeoffs around atomic increment, migration complexity, and query patterns
- [Affects R5][Technical] Migration strategy: run at app startup via DB migration, or as a lazy backfill on first project load?
- [Affects R7, R8][Needs research] What component currently renders the project badge in each view (kanban card, session list, session header)? Is there a shared component or are they separate implementations?
- [Affects R8][Technical] How should `KanbanCardData` and related DTOs be extended — add `sequenceId: number | null` or derive it at the view layer?

## Next Steps

→ Create a structured implementation plan in docs/plans/
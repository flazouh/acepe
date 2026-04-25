---
title: "feat: Add per-project session sequence IDs"
type: feat
status: active
date: 2026-04-05
origin: docs/brainstorms/2026-04-05-session-project-sequence-id-requirements.md
---

# feat: Add per-project session sequence IDs

## Overview

Add a persistent, monotonically increasing integer ID scoped to each project for Acepe-native sessions. Displayed as `#N` next to the project letter badge everywhere it appears — kanban cards, session list, and session header. Scanned/discovered sessions get no ID.

## Problem Frame

Sessions use UUIDs internally and display titles that can be similar or auto-generated. Users need a short, stable identifier like `#3` to quickly distinguish and reference sessions within a project. (see origin: `docs/brainstorms/2026-04-05-session-project-sequence-id-requirements.md`)

## Requirements Trace

- R1. Persistent, monotonically increasing integer ID per project for native sessions
- R2. IDs assigned at creation time, only to native sessions; persists through lifecycle transitions
- R3. IDs never reused or reassigned within a project
- R4. Next ID = MAX(existing project IDs) + 1
- R5. Backfill existing native sessions by `createdAt` order on first launch
- R6. Scanned sessions skipped during backfill
- R7. Display as `#N` right of project letter badge
- R8. Shown in kanban cards, session list, session header
- R9. Scanned sessions show badge only, no `#N`

## Scope Boundaries

- IDs are display-only — no routing, URLs, or API references
- No search-by-ID functionality
- No user ability to rename or override the number
- Scanned/imported sessions excluded from numbering
- Primary display locations: kanban card, agent panel header, session list. Other badge locations (command palette, file explorer, terminal panel) are follow-up

## Context & Research

### Relevant Code and Patterns

- **Column addition pattern**: `m20260318_000002_add_pr_number_to_session_metadata.rs` — `Table::alter()` + `add_column()` + nullable integer. SQLite `down()` is no-op
- **Migration registry**: `packages/desktop/src-tauri/src/db/migrations/mod.rs` — append new migration module + `Box::new()` entry
- **Entity definition**: `packages/desktop/src-tauri/src/db/entities/session_metadata.rs` — add field to `Model` struct
- **Session creation**: `SessionMetadataRepository::insert_created_session()` at `packages/desktop/src-tauri/src/db/repository.rs:753-790` — sets `file_mtime: 0`, `file_size: 0` for native sessions
- **Lifecycle state**: `repository.rs:596-609` — computed from `file_mtime`, `file_size`, `file_path`
- **Rust→TS data flow**: `HistoryEntry` struct in `packages/desktop/src-tauri/src/session_jsonl/types.rs` → Specta auto-generates `packages/desktop/src/lib/services/claude-history-types.ts` → `SessionMetadata` DTO in `packages/desktop/src/lib/acp/application/dto/session-metadata.ts`
- **Kanban card mapping**: `mapItemToCard()` in `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte:394-494` reads from `ThreadBoardItem`
- **ThreadBoardItem**: `packages/desktop/src/lib/acp/store/thread-board/thread-board-item.ts:30-50`
- **Badge component**: `packages/ui/src/components/project-letter-badge/project-letter-badge.svelte`
- **Kanban card badge usage**: `packages/ui/src/components/kanban/kanban-card.svelte:80-86` — `ProjectLetterBadge` in `HeaderCell`
- **Agent panel badge**: `packages/ui/src/components/agent-panel/agent-panel-header.svelte:69-72`
- **Session list**: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte` imports badge

### Institutional Learnings

- **Session identity persistence** (`docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`): New identity fields must thread through the entire persist/restore path. Add round-trip tests for new fields.
- **Kanban panel sync** (`docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md`): Panel state is the source of truth for live threads. Kanban projects from real panels.

## Key Technical Decisions

- **New column on `session_metadata`**: `sequence_id INTEGER NULL`. Follows existing pattern (pr_number, provider_session_id). No join overhead, simple `MAX()` query per project. Null for scanned sessions.
- **Backfill in migration**: The migration adds the column, then runs a SQL UPDATE to assign IDs to existing native sessions ordered by `created_at`. This keeps it atomic and runs once on startup via `Migrator::up()`.
- **Assignment at creation time**: `insert_created_session()` computes `MAX(sequence_id) + 1` for the project_path before inserting. This is safe because session creation is single-threaded (one Tauri process).
- **Nullable field, not zero**: Scanned sessions have `sequence_id = NULL`, not 0. This makes the distinction explicit in queries and DTOs.

## Open Questions

### Resolved During Planning

- **Column vs. separate table?** Column on `session_metadata`. Follows existing patterns, no join overhead, atomic with existing queries.
- **Migration vs. lazy backfill?** Migration with inline backfill SQL. Runs once automatically via `Migrator::up()`. No lazy complexity.
- **Badge rendering locations?** Three primary: kanban card (`kanban-card.svelte`), session header (`agent-panel-header.svelte`), session list (`session-list-ui.svelte`). Other badge consumers (palette, file explorer, terminal) are follow-up.
- **DTO extension approach?** Add `sequenceId: number | null` to `SessionMetadata` DTO. Flows through `SessionCold` → `ThreadBoardItem` → `KanbanCardData` → components.

### Deferred to Implementation

- Exact SQL for backfill UPDATE with window function (ROW_NUMBER over project_path partition ordered by created_at) — needs SQLite version verification at implementation time
- Whether `session-list-ui.svelte` renders its own badge or delegates to a shared component — needs code reading at implementation time

## Implementation Units

- [ ] **Unit 1: Database migration — add `sequence_id` column with backfill**

**Goal:** Add nullable integer column to `session_metadata` and backfill existing native sessions with sequential IDs per project.

**Requirements:** R1, R3, R4, R5, R6

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src-tauri/src/db/migrations/m20260405_000001_add_sequence_id_to_session_metadata.rs`
- Modify: `packages/desktop/src-tauri/src/db/migrations/mod.rs`
- Modify: `packages/desktop/src-tauri/src/db/entities/session_metadata.rs`

**Approach:**
- Add `sequence_id: Option<i32>` to the entity `Model`
- Migration `up()`: ALTER TABLE to add nullable integer column, then run a backfill SQL using a subquery that assigns ROW_NUMBER() partitioned by `project_path` ordered by `created_at` — but only for rows where `file_mtime = 0 AND file_size = 0` (native session indicator)
- Scanned sessions (non-zero file_mtime/file_size) are left NULL
- Migration `down()`: no-op (SQLite limitation)
- Register in `mod.rs` migration vec

**Patterns to follow:**
- `m20260318_000002_add_pr_number_to_session_metadata.rs` for column addition structure
- `m20260329_000001_add_provider_session_id_to_session_metadata.rs` for nullable field pattern

**Test scenarios:**
- Happy path: migration adds column, existing native sessions get sequential IDs per project starting at 1
- Happy path: two projects with interleaved creation times get independent ID sequences (#1, #2 for project A; #1, #2 for project B)
- Edge case: scanned sessions (file_mtime > 0) remain NULL after migration
- Edge case: project with no native sessions — no IDs assigned, no errors
- Edge case: migration is idempotent — running on an already-migrated DB does nothing

**Verification:**
- `cargo test --lib` passes
- Database inspection shows correct sequence_id values after migration on test data

- [ ] **Unit 2: Assign sequence ID during session creation**

**Goal:** When a native session is created, compute and assign the next sequence ID for its project.

**Requirements:** R1, R2, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/db/repository.rs`
- Test: `packages/desktop/src-tauri/src/db/repository_tests.rs` (or wherever repository tests live)

**Approach:**
- In `insert_created_session()`, before inserting, query `SELECT MAX(sequence_id) FROM session_metadata WHERE project_path = ?` (includes both native and any future edge cases)
- Set `sequence_id = max_id + 1` (or 1 if NULL/no rows)
- This is safe: session creation is single-threaded in the Tauri process
- Return the assigned sequence_id from the function so callers can propagate it

**Patterns to follow:**
- Existing `insert_created_session()` structure in `repository.rs:753-790`

**Test scenarios:**
- Happy path: first native session in a project gets sequence_id = 1
- Happy path: second native session in same project gets sequence_id = 2
- Happy path: native session in a different project gets sequence_id = 1 (independent counters)
- Edge case: if a session with sequence_id = 5 is deleted, next session gets 6 (not 5)
- Edge case: project has only scanned sessions (all NULL sequence_id) — first native session gets 1

**Verification:**
- `cargo test --lib` passes with new repository tests
- `cargo clippy` clean

- [ ] **Unit 3: Thread sequence ID through Rust → TypeScript data flow**

**Goal:** Expose `sequence_id` from the database through the Tauri command layer to the TypeScript frontend.

**Requirements:** R1, R7, R8

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/types.rs` (HistoryEntry struct)
- Modify: `packages/desktop/src-tauri/src/session_jsonl/commands.rs` (get_session_history mapping)
- Modify: `packages/desktop/src/lib/services/claude-history-types.ts` (auto-generated, verify after Specta re-export)
- Modify: `packages/desktop/src/lib/acp/application/dto/session-metadata.ts`

**Approach:**
- Add `sequence_id: Option<i64>` to `HistoryEntry` struct with `#[serde(rename = "sequenceId")]`
- In `get_session_history()`, map `s.sequence_id` into the HistoryEntry builder (line ~99-114)
- Run `cargo test export_types -- --nocapture` to regenerate Specta types
- Add `readonly sequenceId?: number` to `SessionMetadata` DTO
- Thread through session-repository.ts where `SessionCold` objects are built from `HistoryEntry`

**Patterns to follow:**
- How `pr_number` flows through: entity → HistoryEntry → commands.rs mapping → TS DTO
- How `sessionLifecycleState` is mapped in `session-repository.ts:261-263`

**Test scenarios:**
- Happy path: `get_session_history` returns entries with correct `sequenceId` for native sessions
- Happy path: scanned sessions have `sequenceId` as null/undefined in the response
- Integration: round-trip — create session in DB with sequence_id, fetch via command, verify TS receives correct value

**Verification:**
- `cargo test --lib` passes
- `bun run check` passes after DTO changes
- Specta-generated types include `sequenceId`

- [ ] **Unit 4: Thread sequence ID into kanban and session display types**

**Goal:** Make `sequenceId` available in `ThreadBoardItem`, `KanbanCardData`, and `SessionListItem` so UI components can render it.

**Requirements:** R7, R8, R9

**Dependencies:** Unit 3

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/thread-board/thread-board-item.ts`
- Modify: `packages/ui/src/components/kanban/types.ts`
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-types.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte` (mapItemToCard)
- Modify: `packages/desktop/src/lib/acp/store/thread-board/build-thread-board.ts`
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-logic.ts`

**Approach:**
- Add `readonly sequenceId: number | null` to `ThreadBoardItem`
- Add `readonly sequenceId: number | null` to `KanbanCardData`
- Add `sequenceId?: number` to `SessionListItem`
- In `mapItemToCard()`, pass through `item.sequenceId` (or null for scanned)
- In thread-board builder, read `sequenceId` from `SessionCold` metadata
- In session-list builder, read `sequenceId` from session metadata

**Patterns to follow:**
- How `projectName` and `projectColor` flow from thread-board builder → ThreadBoardItem → mapItemToCard → KanbanCardData

**Test scenarios:**
- Happy path: KanbanCardData includes correct sequenceId for a native session
- Happy path: KanbanCardData has null sequenceId for a scanned session
- Happy path: SessionListItem includes sequenceId from session metadata

**Verification:**
- `bun run check` passes
- `bun test` passes (existing tests still green)

- [ ] **Unit 5: Render `#N` next to project badge in UI components**

**Goal:** Display the sequence ID as `#N` immediately to the right of the project letter badge in kanban cards, agent panel header, and session list.

**Requirements:** R7, R8, R9

**Dependencies:** Unit 4

**Files:**
- Modify: `packages/ui/src/components/kanban/kanban-card.svelte`
- Modify: `packages/ui/src/components/agent-panel/agent-panel-header.svelte`
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte` (or its child components)
- Test: `packages/ui/src/components/kanban/kanban-card.test.ts` (if exists, or create)

**Approach:**
- In each component, after the `ProjectLetterBadge`, conditionally render `<span class="text-xs text-muted-foreground">#{sequenceId}</span>` when `sequenceId` is not null
- Keep badge and ID in the same `HeaderCell` so they form a visual unit
- Use existing text styling conventions (check what `text-muted-foreground` or similar classes are used for secondary info)
- For kanban cards: render inside the existing `<HeaderCell withDivider={false}>` that contains the badge
- For agent panel header: same pattern, inside the badge's `HeaderCell`
- For session list: add near where project name/badge is shown

**Patterns to follow:**
- How PR badge is conditionally rendered next to session info in `session-item.svelte:265-281`
- Existing kanban card header structure at `kanban-card.svelte:80-86`

**Test scenarios:**
- Happy path: kanban card renders `#3` next to badge when sequenceId is 3
- Happy path: agent panel header renders `#1` next to badge when sequenceId is 1
- Edge case: when sequenceId is null (scanned session), no `#N` is rendered — badge displays alone
- Edge case: large sequence numbers (e.g., #999) render without layout overflow

**Verification:**
- `bun run check` passes
- Visual inspection: badge shows `[A] #3` pattern in kanban, header, and list
- Scanned sessions show badge only

- [ ] **Unit 6: Propagate sequence ID through session creation frontend path**

**Goal:** When a new session is created via the frontend, the assigned sequence ID flows into the session store immediately.

**Requirements:** R2, R7

**Dependencies:** Unit 2, Unit 3, Unit 4

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-repository.ts`

**Approach:**
- In `session-connection-manager.ts:322`, where `sessionLifecycleState: "created"` is set, the initial shell won't have a sequenceId yet (it's assigned server-side in Rust)
- Two options: (a) return the sequenceId from the Tauri `create_session` command response, or (b) set it optimistically in the frontend before the Tauri call
- Preferred: (a) — the Rust side is the source of truth for the counter. After `insert_created_session()` returns the ID, include it in the Tauri command response, then update the session metadata in the store
- Update session-repository.ts merge logic to preserve `sequenceId` through session updates (similar to how `sessionLifecycleState` is merged at line 261-263)

**Patterns to follow:**
- How `sessionLifecycleState` is set at creation in `session-connection-manager.ts:322`
- How session metadata merging works in `session-repository.ts:258-266`

**Test scenarios:**
- Happy path: creating a session via UI results in the session store having the correct sequenceId
- Happy path: sequenceId survives session metadata updates (e.g., title change) without being lost
- Edge case: session creation with no prior sessions in the project → sequenceId = 1

**Verification:**
- `bun run check` passes
- `bun test` passes
- Manual test: create a new session, verify `#N` appears immediately in kanban card

## System-Wide Impact

- **Interaction graph:** `insert_created_session()` → `get_session_history()` → session store → thread-board builder → kanban view / session list / agent panel header
- **Error propagation:** If MAX query fails during session creation, session creation should still succeed (sequence_id can be NULL as fallback). Log the error.
- **State lifecycle risks:** Race conditions are not a concern — session creation is single-threaded in the Tauri process. The backfill migration runs before any user interaction.
- **API surface parity:** The `KanbanCardData` type in `@acepe/ui` gains a new field — any external consumer of this type needs updating. `HistoryEntry` (Specta-generated) gains `sequenceId`.
- **Unchanged invariants:** Session UUIDs remain the primary identifier for routing, persistence, and ACP communication. The sequence ID is display-only and never used for lookups.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| SQLite window function (ROW_NUMBER) may not be available in older SQLite versions | SQLite 3.25+ (2018) supports window functions. Tauri bundles SQLite 3.40+. Safe. |
| Backfill migration on large databases could be slow | Single SQL UPDATE with window function — efficient for SQLite. Thousands of sessions would take < 1 second. |
| Sequence ID gap after session deletion may confuse users | Documented in requirements as intentional (R3). IDs are never reused. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-05-session-project-sequence-id-requirements.md](docs/brainstorms/2026-04-05-session-project-sequence-id-requirements.md)
- Related patterns: `m20260318_000002_add_pr_number_to_session_metadata.rs`, `m20260329_000001_add_provider_session_id_to_session_metadata.rs`
- Session identity persistence learning: `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`

---
title: refactor: Make persisted session open canonical and self-describing
type: refactor
status: active
date: 2026-04-17
deepened: 2026-04-17
---

# refactor: Make persisted session open canonical and self-describing

## Overview

Replace the persisted session reopen path that still depends on `SessionThreadSnapshot` and context-sensitive `ToolCallData` deserialization. The clean architecture is: session identity and title come from metadata/overlay state, transcript content comes from `session_transcript_snapshot`, runtime state comes from `session_projection_snapshot`, and legacy full-thread snapshots are treated as an import-only compatibility source rather than a steady-state read model.

## Problem Frame

Persisted sessions currently reopen through a mixed contract. `SessionOpenResult` is supposed to be canonical and reopen-safe, but the backend still reads `session_thread_snapshot` to recover the session title and to backfill transcript data when `session_transcript_snapshot` is absent. That thread snapshot stores `StoredEntry::ToolCall` with `ToolCallData`, whose serde path now requires ambient agent context. As a result, persisted sessions with tool calls can be stored successfully yet fail to reopen because the steady-state read path is not self-describing.

The direct user symptom is an apparently empty reopened session even though the session is present in SQLite and the canonical content already exists or can be derived. The architectural problem is broader: persisted state is split between a canonical reopen contract and a legacy full-thread structure whose deserialization semantics leak provider context into generic repository reads.

## Requirements Trace

- R1. Reopening a persisted session must not require ambient agent context or provider-specific deserialization state.
- R2. The steady-state persisted-open path must read from explicit canonical sources only: session identity/title metadata, transcript snapshot, and projection snapshot.
- R3. Legacy `session_thread_snapshot` rows must be isolated to a compatibility import path, not loaded during normal open/resume flows.
- R4. Session title and related reopen metadata must come from explicit authoritative fields rather than from a legacy thread payload.
- R5. Canonical reopen, resume, and legacy-import paths must be covered by regression tests that include persisted tool calls.

## Scope Boundaries

- This plan does not redesign live streaming ingestion or frontend rendering.
- This plan does not change provider-specific history parsers beyond what is needed to produce canonical persisted state.
- This plan does not remove `SessionThreadSnapshot` as an in-memory interchange type where provider import code still benefits from it.

### Deferred to Separate Tasks

- Schema cleanup to drop the `session_thread_snapshot` table entirely after all legacy rows have a proven import/deletion path.
- Reopen restoration of `current_mode_id` or other mode UX state. This refactor leaves mode rehydration unchanged and does not extend the persisted-open contract for mode state.
- Any display-layer cleanup that becomes unnecessary once canonical reopen is fixed.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs` currently assembles `SessionOpenFound` from transcript, projection, and thread snapshot, using the thread snapshot as title authority and transcript fallback.
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` (`load_transcript_snapshot_for_resume`) already prefers `session_transcript_snapshot` first, but still falls back to `session_thread_snapshot`.
- `packages/desktop/src-tauri/src/history/commands/session_loading.rs` materializes canonical state, persists transcript/projection snapshots, and already contains the right seam for one-time legacy import.
- `packages/desktop/src-tauri/src/acp/transcript_projection/snapshot.rs` demonstrates the desired canonical read model: context-free, UI-oriented, and derived from stored entries without provider-specific runtime requirements.
- `packages/desktop/src-tauri/src/acp/projections/mod.rs` already projects legacy thread entries into canonical interaction/operation state, which makes it the right place to keep legacy import semantics rather than steady-state open semantics.
- `packages/desktop/src-tauri/src/acp/agent_context.rs` provides the explicit `with_agent(...)` scope that should remain confined to parser/import boundaries instead of repository reads.

### Institutional Learnings

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` reinforces the architectural rule that provider-specific meaning should live in explicit contracts and boundaries, not be inferred from presentation data or local heuristics.
- `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md` shows the same persistence lesson in another area: restore paths should carry explicit identity/state rather than relying on later repair.

### External References

- None. The repo already has strong local patterns for canonical snapshot materialization and provider-boundary handling.

## Key Technical Decisions

- **Canonical persisted-open contract uses three explicit sources only:** `session_metadata`/`acepe_session_state` for identity and title, `session_transcript_snapshot` for content, and `session_projection_snapshot` for operations/interactions/turn state. This removes hidden serde requirements from steady-state reopen.
- **Legacy thread snapshots become import-only compatibility input:** code may still deserialize them, but only inside a dedicated compatibility/materialization helper that runs under explicit agent context and immediately writes canonical state.
- **Title authority moves out of the thread snapshot:** `SessionOpenFound.session_title` should be resolved from explicit persisted metadata (title override, display title, canonical fallback), not from `SessionThreadSnapshot.title`.
- **Canonical backfill deletes or invalidates the legacy dependency once imported:** after using a legacy thread snapshot to build transcript/projection/title state, the canonical snapshots become the only reopen contract for that session.
- **Repository APIs should reflect the architectural boundary:** generic repository getters should not require hidden runtime context; context-aware parsing stays in higher-level import/materialization code.
- **Canonical import must be atomic at the snapshot boundary:** transcript and projection writes must succeed together or fail the import step together, so reopen never serves transcript content with missing interaction/operation state.

## Open Questions

### Resolved During Planning

- **Should the immediate fix simply wrap `SessionThreadSnapshotRepository::get()` in `with_agent(...)`?** No. That repairs the bug but preserves the architectural smell of context-sensitive generic persistence reads.
- **Does the canonical reopen path need a new table to carry title metadata?** No. Existing metadata/overlay state already provides explicit title authority; the refactor should use that instead of reviving thread snapshots for title lookup.
- **Should legacy thread snapshots remain part of steady-state reopen for transcript fallback?** No. Fallback belongs in a dedicated canonical materialization/import helper, not in open/resume assembly.

### Deferred to Implementation

- **Whether legacy thread rows are deleted immediately after successful import or retained but never read again:** implementation can choose the safer cleanup timing as long as steady-state reopen no longer depends on them.
- **Whether to extract a new helper module (for example under `history/`) or keep the new canonical loading helpers in existing files:** choose the shape that keeps boundaries clearest once the code is edited.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
open/resume request
  -> resolve_session_context()
  -> load canonical identity/title
       from acepe_session_state.title_override
       else session_metadata.display
       else default_session_title(session_id)
  -> load canonical transcript snapshot
  -> load canonical projection snapshot
  -> if canonical state missing:
       import legacy source once
         provider-owned history OR legacy thread snapshot
       persist transcript + projection (+ title metadata if needed)
       optionally invalidate legacy thread row
  -> assemble SessionOpenFound from canonical state only
```

The important boundary is that `with_agent(...)` is permitted only inside the legacy/provider import step. It must not appear in the steady-state repository read path for canonical reopen.

## Implementation Units

- [ ] **Unit 1: Establish a canonical session-open loader**

**Goal:** Centralize the persisted-open contract so session open and resume read from explicit canonical sources rather than reaching into `session_thread_snapshot`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Modify: `packages/desktop/src-tauri/src/history/session_context.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`

**Approach:**
- Introduce a single helper boundary for loading canonical persisted state used by both session open and resume.
- Resolve canonical title through an explicit helper (for example `resolve_canonical_session_title(db, session_id)`) so `assemble_session_open_result` and resume code do not depend on thread snapshots for title lookup.
- Resolve `session_title` from explicit persisted metadata (`acepe_session_state.title_override`, then `session_metadata.display`, then default title) instead of `SessionThreadSnapshot.title`.
- Make `SessionOpenFound` assembly and resume hydration depend on transcript/projection snapshots plus metadata, not on a thread snapshot fallback embedded in the assembly code.
- When canonical transcript/projection state is absent, the new loader delegates to the compatibility materialization helper introduced in Unit 2 and then retries the canonical read.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs` existing open-result assembly
- `packages/desktop/src-tauri/src/history/session_context.rs` replay-context resolution

**Test scenarios:**
- Happy path — persisted session with transcript + projection snapshots and tool-call history reopens successfully without touching thread snapshot data.
- Happy path — persisted session with title override returns the override in `sessionTitle`.
- Edge case — persisted session with no title override and no display title falls back to `Session <id-prefix>`.
- Error path — corrupted transcript snapshot returns `SessionOpenResult::Error` without attempting context-sensitive thread parsing.
- Error path — resume with absent transcript snapshot and failed compatibility import returns surfaced invalid-state failure instead of an empty session.
- Integration — `get_session_open_result` and resume hydration resolve the same canonical title/content for the same session id.

**Verification:**
- Session open and resume code paths no longer require `SessionThreadSnapshotRepository::get()` to succeed for canonical reopen.

- [ ] **Unit 2: Isolate legacy thread snapshots behind an explicit import/materialization path**

**Goal:** Keep legacy compatibility without allowing `session_thread_snapshot` to remain part of the normal persisted-open contract.

**Requirements:** R1, R2, R3, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository.rs`
- Test: `packages/desktop/src-tauri/src/db/repository_test.rs`
- Test: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`

**Approach:**
- Move any remaining thread-snapshot deserialization behind a compatibility helper that is explicitly supplied with the resolved parser agent type.
- Restrict repository responsibilities to raw row retrieval / canonical DTO loading; do not let a generic repository getter perform context-sensitive `StoredEntry` parsing as part of normal reopen.
- Refactor `ensure_canonical_session_materialized(...)` into the explicit compatibility seam and wrap its legacy thread-snapshot parse with the resolved parser agent type so tool-call sessions can import successfully.
- Use the compatibility path only when canonical transcript/projection state is absent and the session still needs one-time import from legacy persisted data.
- Persist transcript and projection snapshots in one transactional import step, or enforce equivalent fail-whole-step semantics, so partial canonical writes cannot survive a crash or DB error.
- After successful import, persist canonical state and stop relying on the thread snapshot for future open/resume requests.
- Stop writing fresh `session_thread_snapshot` rows from canonical materialization; legacy thread snapshots remain read-only compatibility input rather than an active write target.

**Execution note:** Start with a failing Rust regression that stores a thread snapshot containing a tool call, then proves canonical import succeeds without the steady-state open path reading that thread snapshot directly.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/agent_context.rs` explicit agent scoping
- `packages/desktop/src-tauri/src/acp/transcript_projection/snapshot.rs` canonical, context-free snapshot design

**Test scenarios:**
- Happy path — legacy session with only `session_thread_snapshot` and tool calls materializes canonical transcript/projection successfully under explicit agent context.
- Edge case — legacy session already materialized to canonical snapshots skips thread import and reopens from canonical state only.
- Error path — legacy thread snapshot with malformed payload fails the import helper with a surfaced error instead of silently opening an empty session.
- Integration — successful legacy import persists canonical snapshots transactionally so a second reopen succeeds without re-importing legacy data.
- Integration — successful canonical materialization does not write a fresh `session_thread_snapshot` row.

**Verification:**
- The only remaining code path that deserializes a legacy thread snapshot is an explicit compatibility/materialization helper, not the normal open/resume path.

- [ ] **Unit 3: Preserve title precedence through canonical open hydration**

**Goal:** Ensure the backend’s canonical title resolution and the frontend’s open hydration keep the same explicit title precedence after the thread-snapshot dependency is removed.

**Requirements:** R2, R4

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-store-load-title.vitest.ts`
- Test: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`

**Approach:**
- Treat persisted title as metadata state, not thread-content state.
- Ensure canonical session-open assembly uses the same persisted title precedence the frontend already expects.
- Keep `current_mode_id` explicitly out of scope for this refactor; this unit is about title parity only.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/session-title-policy.ts`
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`

**Test scenarios:**
- Happy path — `title_override` beats metadata display title during open hydration.
- Edge case — metadata display title is used when no override exists.
- Edge case — absent persisted title yields deterministic fallback title.
- Integration — frontend session store hydrates the same title that backend `SessionOpenFound.sessionTitle` emits.

**Verification:**
- Session title shown after reopen comes from explicit persisted metadata precedence, with no dependence on thread snapshot title fields.

- [ ] **Unit 4: Remove canonical reopen’s dependency on legacy thread reads and tighten regression coverage**

**Goal:** Finish the architectural cutover by updating call sites, tests, and invariants so regressions are caught where the bug was introduced.

**Requirements:** R1, R2, R3, R5

**Dependencies:** Units 1-3

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository_test.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Modify: `packages/desktop/src/lib/components/main-app-view/tests/open-persisted-session.test.ts`
- Test: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`

**Approach:**
- Delete or rewrite tests that currently encode thread-snapshot fallback as the expected open-time behavior.
- Replace them with invariants about canonical reopen: transcript/projection/title metadata are sufficient; legacy import happens once and then disappears behind canonical snapshots.
- Cover the previously broken case specifically: persisted tool-call sessions reopen without empty-state fallback.
- Seed the regression fixture with at least one `StoredEntry::ToolCall` inside the legacy thread snapshot so the test exercises the actual deserialization failure that caused the bug.

**Patterns to follow:**
- Existing focused session-open and persisted-session tests in Rust and Svelte

**Test scenarios:**
- Happy path — persisted session with tool calls reopens into a populated panel instead of empty “Ready to assist”.
- Edge case — alias-keyed open still resolves canonical session id while using canonical snapshots only.
- Error path — if canonical snapshots are missing and legacy import also fails, the user gets a load error rather than an empty session.
- Integration — opening the same persisted session twice produces the same transcript/projection/title and does not re-import legacy data on the second open.

**Verification:**
- Canonical reopen behavior is fully covered by focused Rust and frontend tests, and the previous empty-session regression is explicitly locked down.

## System-Wide Impact

- **Interaction graph:** `get_session_open_result`, resume hydration, canonical materialization, session-store hydration, and persisted-session UI open tests all depend on the new canonical read boundary.
- **Error propagation:** load failures should surface as explicit open/resume errors; they must not degrade into empty sessions caused by hidden fallback behavior.
- **State lifecycle risks:** legacy import must avoid partial canonical writes that leave transcript and projection out of sync; import should persist both or fail clearly.
- **Atomicity requirement:** the canonical transcript/projection import step should use one DB transaction or an equivalent all-or-nothing guard.
- **API surface parity:** both session open and async resume must consume the same canonical transcript/title semantics so persisted sessions do not behave differently depending on entry point.
- **Integration coverage:** tests must cross backend snapshot loading and frontend hydration so title/content drift cannot hide behind separate unit tests.
- **Unchanged invariants:** provider-owned history parsing still happens at provider/import edges, and live delta/event buffering contracts remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Canonical transcript/projection snapshots drift during legacy import | Persist both from the same import step and add integration tests that reopen twice after import |
| Session title precedence changes unintentionally during cutover | Reuse existing frontend title precedence tests and add backend open-result coverage for override/display/default cases |
| Some call site still reads `session_thread_snapshot` in the steady-state path | Search-based cleanup plus focused tests for open, resume, and canonical materialization |
| Canonical import partially succeeds and leaves transcript without projection | Use a DB transaction or equivalent fail-whole-step import guard, then add a regression test that verifies reopen does not serve partial canonical state |
| Legacy sessions with malformed thread rows become harder to recover | Fail loudly with a surfaced error and keep the explicit compatibility helper small and testable |

## Documentation / Operational Notes

- If this refactor lands, document the architectural rule in `docs/solutions/` after implementation: canonical persisted-open reads must remain context-free, with provider/agent parsing confined to import boundaries.
- Tauri QA should specifically reopen the known persisted session containing tool calls after the backend change, because the failure mode is visible at the app level even when the database contains valid data.

## Sources & References

- Related code: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`
- Related code: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Related code: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Related code: `packages/desktop/src-tauri/src/db/repository.rs`
- Related code: `packages/desktop/src-tauri/src/acp/transcript_projection/snapshot.rs`
- Related code: `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- Related learnings: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- Related learnings: `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`

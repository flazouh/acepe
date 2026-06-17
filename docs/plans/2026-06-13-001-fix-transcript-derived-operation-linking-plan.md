---
title: "fix: Transcript-derived operation linking for restored sessions"
type: fix
status: active
date: 2026-06-13
---

# fix: Transcript-derived operation linking for restored sessions

## Overview

Restored ClaudeCode sessions show every tool call as "Unresolved tool" because two independent ingress paths produce mismatched `OperationSourceLink::TranscriptLinked.entry_id` formats. The fix introduces `relink_operations_to_transcript` — a pure function that bridges the mismatch after both transcript and operations are built but before any degradation guard fires. The compensator `ensure_transcript_tool_operations` is demoted to a strict `tracing::error!` assertion once the format mismatch is eliminated.

## Problem Frame

When a `ProviderOwnedSessionSnapshot` is materialized from a ClaudeCode JSONL file, two independent paths run in sequence:

1. **Transcript ingress** (`from_canonical_events` in `transcript_projection/snapshot.rs`) computes Acepe-owned display IDs: `"acepe::entry::{turn_key}::tool::toolu_01xyz"`
2. **Operation ingress** (`import_thread_snapshot` in `projections/operations.rs`) sets `OperationSourceLink::TranscriptLinked { entry_id: "toolu_01xyz" }` — the raw provider tool-call ID

These never match. `ensure_transcript_tool_operations` (`session_materialization/mod.rs`) papers over the gap by minting a degraded "Unresolved tool" `OperationSnapshot` for every unmatched transcript tool row. That degraded op wins the `buildOperationIndex` lookup in TypeScript and renders as "Unresolved tool" in the session panel.

The canonical rule (see learnings in Context section): `OperationSnapshot.source_link.kind === "transcript_linked"` with matching `entry_id` is the **sole** transcript–operation join authority. Manufacturing degraded fallback ops is an implicit secondary join path — the pattern the GOD architecture explicitly forbids.

## Requirements Trace

- R1. Restored ClaudeCode sessions render real tool names (no "Unresolved tool" entries) from the first open, before any attach/resume event
- R2. `OperationSnapshot.source_link.entry_id` is an Acepe-owned display ID (`"acepe::entry::..."`) for all `TranscriptLinked` operations leaving the materialization layer
- R3. `ensure_transcript_tool_operations` is a strict assertion after the fix — no degraded op creation for format mismatches; any firing indicates genuine missing provider evidence
- R4. The canonical ingress order — transcript built first, operations linked against it — is codified in `CONTEXT.md`

## Scope Boundaries

- `import_thread_snapshot` signature unchanged — raw ID ingestion at that level is intentional; relinking is a post-step
- `SessionSnapshot` shape unchanged
- `ProjectionRegistry` interface unchanged
- No TypeScript changes — this is a Rust canonical producer fix
- `merge_provider_tool_rows_into_local_transcript` audit is deferred (separate concern)

### Deferred to Separate Tasks

- Delete `degraded_transcript_tool_operation` and the `ensure_transcript_tool_operations` stub entirely: separate PR once the `tracing::error!` assertion has run clean in production

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/acp/session_materialization/mod.rs` — `materialize_provider_owned_thread_snapshot` (lines 27–81), `ensure_transcript_tool_operations` (lines 130–165), `degraded_transcript_tool_operation` (lines 221–263), inline tests (line 282+)
- `packages/desktop/src-tauri/src/acp/transcript_projection/display_id.rs` — `derive_tool_entry_id`, `tool_call_id_from_authority_entry_id` (`pub`, line 106); already re-exported from `transcript_projection` mod
- `packages/desktop/src-tauri/src/acp/projections/operations.rs` — `import_thread_snapshot`, `OperationSourceLink::transcript_linked` constructor
- `packages/desktop/src-tauri/src/acp/transcript_projection/snapshot.rs` — `TranscriptSnapshot { entries: Vec<TranscriptEntry> }`, `TranscriptEntry { entry_id, role, .. }`, `TranscriptEntryRole::Tool`
- `packages/desktop/src-tauri/src/acp/projections/types/operation.rs` — `OperationSourceLink` enum, `OperationSnapshot` struct (fields: `tool_call_id: String`, `source_link: OperationSourceLink`)
- `packages/desktop/src-tauri/src/acp/projections/tests/mod.rs` — lines ~1116–1119 and ~2553–2556 assert raw `entry_id` from `project_thread_snapshot` (correct intermediate behavior, unchanged); lines ~527, ~561, ~1601 assert acepe:: format from live paths

### Institutional Learnings

- `docs/solutions/integration-issues/2026-04-30-cursor-acp-tool-call-id-normalization-and-enrichment-path.md` — exact structural precedent: Cursor had the same two-path mismatch; fix approach is nearly identical. Key rule: "for restored sessions, transcript `entry_id` and operation `source_link.entry_id` must already match before any attach/resume event is processed."
- `docs/solutions/ui-bugs/agent-panel-graph-materialization-rendering-bug-2026-04-28.md` — `ensure_transcript_tool_operations`-family logic must never fire on valid-but-mismatched ops; relinking must precede any degradation guard
- `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md` — canonical rule: raw provider tool-call IDs are metadata; `"acepe::entry::..."` is the display identity
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` — sole join authority is `source_link.kind === "transcript_linked"` + matching `entry_id`; no fallback joins by raw ID, position, or title

## Key Technical Decisions

- **Option B (post-hoc relinking) over Option A (turn tracking in `import_thread_snapshot`):** The transcript is already the canonical authority and is built first. Relinking operations against the finished transcript is the minimal fix — no state needs threading through `import_thread_snapshot`.
- **Pure function signature `fn relink_operations_to_transcript(transcript: &TranscriptSnapshot, operations: Vec<OperationSnapshot>) -> Vec<OperationSnapshot>`:** Consistent with `ensure_transcript_tool_operations`'s current shape; independently testable.
- **Map key is the normalized tool_call_id extracted from the acepe entry_id:** `tool_call_id_from_authority_entry_id` extracts the same normalized form stored in `OperationSnapshot.tool_call_id`. The map key must be the normalized form to ensure lookup hits, including control-character cases.
- **Demotion to `tracing::error!`:** After relinking, any `TranscriptLinked` operation still unmatched is genuine missing provider evidence, not a format mismatch. The GOD architecture forbids silent degradation as a substitute for a correct join.
- **`import_thread_snapshot` intermediate output (raw entry_ids in `ProjectionSnapshot`) remains valid:** Tests at `projections/tests/mod.rs` lines ~1116, ~2553 document correct intermediate behavior and do not change — relinking only happens in `materialize_provider_owned_thread_snapshot`.
- **`HashMap` must be added to imports in `session_materialization/mod.rs`:** Currently only `HashSet` is imported; `HashMap` is needed for the relinking map.

## Open Questions

### Resolved During Planning

- *Transcript side vs. recompute from `turn_key` in operations for map construction?* → Transcript side. Re-deriving from operations would require turn tracking in `import_thread_snapshot` (Option A) and re-introduce the dual-source problem.
- *Delete `degraded_transcript_tool_operation` in this PR?* → Defer. The demotion to `tracing::error!` lands in this PR; deletion is a follow-on after production confirmation.
- *Do projections tests at lines ~1116, ~2553 need updating?* → No. They test `project_thread_snapshot` in isolation — the raw intermediate format is correct at that level.

### Deferred to Implementation

- Exact Rust import organization after adding `HashMap` and `tool_call_id_from_authority_entry_id`
- Whether `degraded_transcript_tool_operation` should be `#[allow(dead_code)]` or deleted in this PR

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
materialize_provider_owned_thread_snapshot
──────────────────────────────────────────────────────────────────
 ProviderOwnedSessionSnapshot
          │
          ▼
  transcript ingress             → TranscriptSnapshot
  (from_canonical_events)          entry.entry_id = "acepe::entry::{turn_key}::tool::toolu_01xyz"
          │
          ▼
  project_thread_snapshot()      → SessionProjectionSnapshot
  (import_thread_snapshot inside)  op.source_link.entry_id = "toolu_01xyz"  ← raw (mismatch here)
          │
          ▼
  drop_unlinked_duplicate_replay_tool_rows()   ← conditional: only if canonical_transcript_events.is_empty()
          │
          ▼  (end of conditional block)
  relink_operations_to_transcript()                               ← NEW: runs unconditionally after both ingress paths
          │   build map: tool_call_id → "acepe::entry::..."
          │   patch:     op.source_link.entry_id = map[op.tool_call_id]
          ▼
  ensure_transcript_tool_operations()                             ← DEMOTED to tracing::error!
          │   any still-unmatched = genuine missing evidence
          ▼
  MaterializedThreadSnapshot
  (transcript + operations: entry_ids now aligned)
```

**Relinking map construction (directional):**

```
// Build: tool_call_id → transcript_entry_id
for entry in transcript.entries where entry.role == Tool:
    if let Some(tc_id) = tool_call_id_from_authority_entry_id(entry.entry_id):
        map[tc_id] = entry.entry_id

// Patch: replace raw entry_id with canonical one
for op in operations where op.source_link is TranscriptLinked:
    let key = normalize_operation_ingress_tool_call_id(op.tool_call_id)
    if let Some(canonical_id) = map[key]:
        op.source_link = TranscriptLinked { entry_id: canonical_id }
```

## Implementation Units

- [ ] **Unit 1: Implement `relink_operations_to_transcript` and its test suite**
- [ ] **Unit 2: Wire relinking call and demote `ensure_transcript_tool_operations`**
- [ ] **Unit 3: Codify transcript-derived operation linking in `CONTEXT.md`**

---

- [ ] **Unit 1: Implement `relink_operations_to_transcript` and its test suite**

**Goal:** Add the pure relinking function to `session_materialization/mod.rs` with full independent test coverage before it is wired into the live pipeline.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_materialization/mod.rs`

**Approach:**
- Add `use std::collections::HashMap` to imports (currently only `HashSet` is present)
- Extend the `transcript_projection` import to include `tool_call_id_from_authority_entry_id` (already `pub`, re-exported from the module)
- Implement `pub(crate) fn relink_operations_to_transcript(transcript: &TranscriptSnapshot, operations: Vec<OperationSnapshot>) -> Vec<OperationSnapshot>`
- Build the map from transcript entries filtered to `TranscriptEntryRole::Tool`, using `tool_call_id_from_authority_entry_id` to extract the normalized key
- For each operation with `OperationSourceLink::TranscriptLinked`, look up `op.tool_call_id` (normalized via `normalize_operation_ingress_tool_call_id`) in the map; patch `entry_id` if found
- Function is silent on misses — the subsequent `ensure_transcript_tool_operations` handles still-unmatched entries after demotion

**Execution note:** Implement test-first — write failing tests for `relink_operations_to_transcript` in the inline `#[cfg(test)] mod tests` block before adding the implementation.

**Patterns to follow:**
- `ensure_transcript_tool_operations` in the same file for function signature shape and test fixture style
- `projections/tests/mod.rs` for how `OperationSourceLink`, `OperationSnapshot`, and `TranscriptEntry` are constructed in test fixtures

**Test scenarios:**
- Happy path: single `TranscriptLinked` operation with matching `tool_call_id` → `source_link.entry_id` is patched to the transcript's acepe:: format value
- Happy path: multiple operations all matching → all entry_ids patched correctly
- Happy path: mix of `TranscriptLinked` and `Synthetic` operations → only `TranscriptLinked` ones are patched; `Synthetic` are unchanged
- Edge case: operation `tool_call_id` not present in transcript map (no match) → entry_id unchanged, operation returned as-is
- Edge case: empty transcript (no `Tool`-role entries) → all operations returned unchanged
- Edge case: empty operations list → empty vec returned
- Edge case: tool_call_id with control characters (e.g. `"toolu\ncall"`) → normalized form used as map key matches what `normalize_operation_ingress_tool_call_id` produces; verifies normalization consistency
- Edge case: `OperationSourceLink::Degraded` variant → not touched (filter applies only to `TranscriptLinked`)
- Idempotency: calling `relink_operations_to_transcript` twice on already-patched operations produces the same result (stable)

**Verification:**
- `cargo test -p acepe-desktop acp::session_materialization` passes with all new tests green
- No existing tests broken

---

- [ ] **Unit 2: Wire relinking call and demote `ensure_transcript_tool_operations`**

**Goal:** Call `relink_operations_to_transcript` at the correct point in `materialize_provider_owned_thread_snapshot`; replace degraded-op creation with `tracing::error!`; update the three inline tests that verified the now-gone degraded behavior; add an integration-level smoke test at the materialize level.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_materialization/mod.rs`

**Approach:**
- In `materialize_provider_owned_thread_snapshot`, insert `relink_operations_to_transcript(&transcript_snapshot, operations)` immediately before `ensure_transcript_tool_operations` — outside the `if canonical_transcript_events.is_empty()` conditional block (`drop_unlinked_duplicate_replay_tool_rows` is inside that conditional; `relink` must run unconditionally after both transcript ingress paths)
- Demote `ensure_transcript_tool_operations`: replace the `degraded_transcript_tool_operation` call with `tracing::error!` carrying structured fields (at minimum: `session_id`, `entry_id` of the unmatched row); return `operations` unchanged for unmatched entries
- `degraded_transcript_tool_operation` becomes dead code — annotate `#[allow(dead_code)]` or delete in this PR (implementation judgment)
- Update three inline tests:
  - `creates_backend_degraded_operation_for_unlinked_transcript_tool_row` → replace: verify the demoted function returns operations unchanged for an unlinked entry (no degraded op created)
  - `degraded_operation_ids_are_stable_for_same_transcript_tool_row` → remove (behavior eliminated)
  - `keeps_existing_source_linked_operation_for_transcript_tool_row` → keep as-is (still valid: matched operations pass through unchanged)
- Add a new integration-level test calling `materialize_provider_owned_thread_snapshot` with a `ProviderOwnedSessionSnapshot` containing canonical_transcript_events with a tool use entry → asserts the resulting operation has `source_link.entry_id` in acepe:: format matching the transcript's entry_id

**Patterns to follow:**
- `tracing::error!` structured key-value style used elsewhere in `acp/` (fully qualified `tracing::error!(key = %value, "message")` — no `use tracing` import needed)
- Existing session fixture construction in inline tests of `session_materialization/mod.rs` (line 282+) for building `ProviderOwnedSessionSnapshot`

**Test scenarios:**
- Integration test: `materialize_provider_owned_thread_snapshot` with one tool call in canonical_transcript_events → resulting operation has `source_link.entry_id` = `"acepe::entry::..."` (not raw `"toolu_01xyz"`)
- Integration test: multiple tool calls in one snapshot → all operations have patched acepe:: entry_ids
- Updated `ensure_transcript_tool_operations` test: unlinked transcript entry after relinking (no match) → function returns operations unchanged, no degraded op, no panic
- Regression: `keeps_existing_source_linked_operation_for_transcript_tool_row` still passes

**Verification:**
- `cargo test -p acepe-desktop acp::session_materialization` passes
- `cargo test -p acepe-desktop acp::projections` passes (tests at lines ~1116, ~2553 remain valid — they test the `project_thread_snapshot` intermediate level which is unchanged)
- QA CLI: G7 session shows real tool names, no "Unresolved tool" entries before any reconnect/attach event

---

- [ ] **Unit 3: Codify transcript-derived operation linking in `CONTEXT.md`**

**Goal:** Name the ingress ordering contract in the domain glossary so future contributors know transcript is built before operations are linked and why.

**Requirements:** R4

**Dependencies:** Unit 2 (so the entry describes implemented reality)

**Files:**
- Modify: `CONTEXT.md`

**Approach:**
- Under the **Canonical model** section, add "transcript-derived operation linking" as a named concept following "Tool identity authority"
- Capture: transcript is built first; operations are linked against the finished transcript; `relink_operations_to_transcript` is the named seam; `ensure_transcript_tool_operations` is a strict assertion post-relinking, not a compensator
- Use existing vocabulary from surrounding entries; no new terms without definitions

**Test expectation:** none — documentation change only

**Verification:**
- Term appears in `CONTEXT.md` using consistent domain vocabulary
- Concept clearly distinguishes the ingress order from earlier patterns and names the two functions

---

## System-Wide Impact

- **Interaction graph:** `materialize_provider_owned_thread_snapshot` is the only caller of `ensure_transcript_tool_operations`. The demotion is local to that call site. `project_thread_snapshot` and `import_thread_snapshot` are unchanged, so all call sites outside the materialization path are unaffected.
- **Error propagation:** `relink_operations_to_transcript` is infallible (pure HashMap lookup). `tracing::error!` in the demoted guard logs to the structured log but does not surface as a user-visible error or return a `Result`.
- **State lifecycle risks:** Relinking operates on an already-built `Vec<OperationSnapshot>`; no shared mutable state. The map is built and consumed within one call to `materialize_provider_owned_thread_snapshot`.
- **API surface parity:** No changes to public Tauri commands, TypeScript types, or `buildOperationIndex`. The fix is purely in Rust canonical data production.
- **Integration coverage:** QA CLI G7 session is the definitive smoke test. The new integration-level test in Unit 2 covers the same logic at the Rust level before any QA session run.
- **Unchanged invariants:** `project_thread_snapshot` output retains raw entry_ids (correct at that intermediate level). Only `materialize_provider_owned_thread_snapshot`'s output is corrected. Existing tests of `project_thread_snapshot` in `projections/tests/mod.rs` remain valid.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `tool_call_id_from_authority_entry_id` returns `None` for some entry_id format variant produced in practice | Unit 1 tests cover the exact format `derive_tool_entry_id` produces; verify against both `from_canonical_events` and `from_stored_entries` output shapes |
| Control-character normalization creates a key mismatch between map and operation lookup | Unit 1 includes an explicit control-character test; both sides use `normalize_operation_ingress_tool_call_id` as the common normalizer |
| Relinking map collision (two transcript entries with same tool_call_id) | Architecturally prevented by one-tool-call-per-transcript-entry invariant; last-write-wins in the map is acceptable; characterize with a test |
| `ensure_transcript_tool_operations` demotion reveals tests that relied on degraded op creation | Explicitly identified (3 inline tests); all addressed in Unit 2 |
| Non-ClaudeCode restored sessions with the same format mismatch | Fix is provider-agnostic; any provider going through `materialize_provider_owned_thread_snapshot` benefits automatically |

## Sources & References

- Related code: `packages/desktop/src-tauri/src/acp/session_materialization/mod.rs`
- Related code: `packages/desktop/src-tauri/src/acp/transcript_projection/display_id.rs`
- Related code: `packages/desktop/src-tauri/src/acp/projections/operations.rs`
- Related code: `packages/desktop/src-tauri/src/acp/projections/types/operation.rs`
- Institutional learning: `docs/solutions/integration-issues/2026-04-30-cursor-acp-tool-call-id-normalization-and-enrichment-path.md`
- Institutional learning: `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`
- Institutional learning: `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`
- Institutional learning: `docs/solutions/ui-bugs/agent-panel-graph-materialization-rendering-bug-2026-04-28.md`

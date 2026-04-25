---
title: fix: Canonicalize Copilot SQL todos
type: fix
status: active
date: 2026-04-12
---

# fix: Canonicalize Copilot SQL todos

## Overview

Teach the Copilot live ACP adapter to recognize SQL tool calls that mutate the session `todos` table, project those mutations into a session-scoped canonical todo snapshot, and emit ordinary todo-shaped canonical tool calls (`kind: todo` plus `normalizedTodos`) so the existing todo UI renders correctly without learning Copilot's SQL transport.

## Problem Frame

Copilot replay already supports explicit `update_todos` tool requests, but the live ACP stream in `packages/desktop/src-tauri/logs/streaming/469a0bf7-0cc0-41ac-b4d0-06ebfc8433c6.jsonl` shows a different transport: Copilot issues SQL tool calls like `INSERT INTO todos ...` with `kind: "other"` and `rawInput.query`. The current canonical path only derives todo semantics from todo-shaped tool names plus a literal `todos` payload, so these SQL-backed todo operations never populate `normalizedTodos` and never route as `kind: todo`.

The clean-architecture requirement is to absorb this provider-specific transport at the Copilot edge. UI and projection layers should continue to consume canonical todo state, not parse SQL strings.

## Requirements Trace

- R1. Copilot live ACP tool calls that target the session `todos` table must be recognized as todo-domain operations, not generic `other`/`search` operations.
- R2. Canonical Copilot todo operations must preserve raw SQL as provenance while exposing `kind: todo` and a stable canonical name for routing.
- R3. Todo rendering consumers must receive a full `normalizedTodos` snapshot after each recognized todo mutation, not only a delta query string.
- R4. Non-todo SQL tool calls must keep their current behavior and must not be reclassified.
- R5. Live Copilot todo behavior must converge with existing replay behavior that already understands explicit `update_todos` requests.
- R6. The design must stay inside the new canonical-operation architecture: provider-specific SQL handling belongs at the adapter/canonicalization boundary, not in the UI.

## Scope Boundaries

- No redesign of the todo UI, todo timing model, or agent panel presentation rules.
- No attempt to make arbitrary SQL queries first-class UI concepts.
- No generalized SQL parser for every table in the session database.
- No replay-format redesign beyond keeping live/replay parity for todo semantics.

### Deferred to Separate Tasks

- Broader support for other SQL-backed domain concepts, if Copilot later transports more than todos through SQL.
- Richer provenance/debug UI for showing the original SQL statement alongside todo operations.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/acp/parsers/copilot_parser.rs` is the live Copilot ACP entry point; it currently only performs shared-chat classification and never upgrades SQL todo traffic into todo semantics.
- `packages/desktop/src-tauri/src/acp/tool_classification.rs` already contains serialized-argument heuristics and explicitly avoids promoting `{description, query}` SQL payloads into `task`, which is correct but leaves todo SQL as `other`.
- `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs` and `packages/desktop/src-tauri/src/acp/session_update/normalize.rs` are the canonicalization seam where `normalizedTodos` is currently derived.
- `packages/desktop/src-tauri/src/acp/parsers/types.rs` contains `parse_todo_write`, which only understands explicit todo payloads (`todos[]`) under todo-like tool names.
- `packages/desktop/src-tauri/src/copilot_history/parser.rs` already proves the intended canonical end state for Copilot replay: `update_todos` becomes `kind: todo` with `normalized_todos`.
- `packages/desktop/src/lib/acp/logic/todo-state.svelte.ts`, `packages/desktop/src/lib/acp/components/tool-calls/tool-call-todo.svelte`, and `packages/desktop/src/lib/acp/components/session-list/session-list-logic.ts` all consume full `normalizedTodos` snapshots from canonical tool calls and should remain unchanged.

### Institutional Learnings

- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` reinforces that runtime ownership belongs in canonical store/projection layers, not ad hoc UI reconstruction.
- The current god-clean operation architecture plan (`docs/plans/2026-04-12-002-refactor-god-clean-operation-model-plan.md`) already sets the boundary rule: provider quirks must be normalized once at the adapter edge and preserved only as provenance after canonicalization.

### External References

- None. The repository and the captured live log provide enough evidence for this bounded provider-adapter fix.

## Key Technical Decisions

- **Treat Copilot SQL-on-`todos` as a provider-specific transport detail**: the Copilot adapter should convert recognized `todos` table mutations into canonical todo operations rather than teaching UI layers to parse SQL.
- **Introduce a session-scoped Copilot todo projector in `session_update`**: because UI consumers expect the latest full todo snapshot, the backend should maintain a per-session projection of todo rows as recognized SQL mutations arrive, and that state should live beside existing session-update canonicalization ownership instead of a new provider-global subsystem.
- **Emit canonical todo identity on the initial tool call**: the initial Copilot tool call must already be promoted to `kind: todo`; later updates should enrich `normalizedTodos`, not re-decide routing.
- **Preserve raw SQL as provenance only**: the original query/result stay in `rawInput`/`rawOutput`, but routing and rendering depend on canonical todo state.
- **Short-circuit generic search/web-search promotion for recognized todo SQL**: once a Copilot SQL query is confidently classified as a todo mutation, both initial tool-call parsing and update classification must bypass generic `query`-driven search/web-search promotion.
- **Invalidate the todo projector on unsupported recognized `todos` SQL**: if a query clearly targets `todos` but cannot be safely applied to the bounded projector model, keep the current tool call as `kind: todo` for routing, omit `normalizedTodos` for that event, and invalidate the session projector so later events do not emit stale “full snapshots.”
- **Map SQL row fields into the existing todo UI contract deliberately**: use `title -> content`, `description -> active_form` when present, and `title` as the fallback `active_form` when description is absent. This keeps the existing UI contract stable without inventing a new todo view model.

## Open Questions

### Resolved During Planning

- **Should we solve this in the UI?** No. The todo UI already consumes canonical snapshots correctly; the gap is at the provider adapter boundary.
- **Do we need a generic SQL tool kind?** No for this fix. The current problem is not “render SQL”; it is “canonicalize Copilot todos carried over SQL.”
- **Is a simple kind remap sufficient?** No. Todo consumers expect `normalizedTodos`, so we need a full snapshot projector, not just `kind: todo`.

### Deferred to Implementation

- Exact helper/module names for the Copilot SQL todo detector and session projector.
- The exact invalidation UX/telemetry when the bounded projector encounters unsupported `todos` SQL after the tool call has already been promoted to `kind: todo`.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
Copilot ACP tool_call
    rawInput.query = "INSERT/UPDATE/DELETE ... todos ..."
                |
                v
     Copilot todo SQL detector
     - recognizes session todos table mutations
     - preserves SQL as provenance
     - bypasses generic search/web search promotion
     - upgrades identity to canonical todo
                |
                v
     session-scoped todo projector
     - seeds pending mutation from tool_call
     - applies mutation on completion using toolCallId + sessionId
     - maintains latest todo row snapshot
     - invalidates on unsupported recognized todos SQL
                |
                v
     canonical ToolCallData / ToolCallUpdateData
     - kind: todo
     - name: update_todos (or equivalent canonical todo name)
     - normalizedTodos: full snapshot
                |
                v
     existing frontend todo consumers
     - tool-call-todo
     - todo-state
     - session-list progress
```

## Implementation Units

- [ ] **Unit 1: Detect Copilot SQL todo operations at the adapter boundary**

**Goal:** Promote recognized Copilot SQL tool calls that operate on the session `todos` table into canonical todo identity on initial parse.

**Requirements:** R1, R2, R4, R6

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src-tauri/src/acp/parsers/copilot_sql_todos.rs`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/copilot_parser.rs`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/tool_classification.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_update/tests.rs`
- Test: `packages/desktop/src-tauri/src/acp/parsers/tests/provider_conformance.rs`

**Approach:**
- Add a Copilot-specific helper that inspects `rawInput.query`, `title`, and `description` for recognized `todos` table mutations.
- Recognize only the bounded mutation grammar needed for the current fix: `INSERT INTO todos ...` and `UPDATE todos ...`. Defer `DELETE` and `SELECT` until real evidence requires them.
- When recognized, synthesize canonical todo identity before `build_tool_call_from_raw()` runs:
  - canonical name should be a todo name already understood by the stack (for example `update_todos`)
  - canonical kind should be `ToolKind::Todo`
- Make the todo-SQL path short-circuit generic `query`-based `Search` / `WebSearch` promotion on both the initial tool call and update reclassification path.
- Preserve the raw SQL query in canonical raw input/provenance fields.
- Leave unsupported SQL untouched as generic behavior.

**Execution note:** Start with a failing parser/canonicalization regression test using the real Copilot SQL log shape.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/parsers/adapters/cursor.rs`
- `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- `packages/desktop/src-tauri/src/acp/session_update/tests.rs`

**Test scenarios:**
- Happy path — a Copilot tool call with `rawInput.query = INSERT INTO todos ...` parses as `kind: todo` with a canonical todo name instead of `other`.
- Happy path — a Copilot tool call with `rawInput.query = UPDATE todos ...` also routes as `kind: todo`.
- Edge case — a generic SQL query with `description` and `query` but no `todos` table reference keeps its current non-todo classification.
- Edge case — a recognized todo SQL query does not get promoted to `search` or `web_search` despite containing `query`.
- Error path — malformed or partially recognized `todos` SQL does not guess a todo classification and remains generic.
- Integration — a recognized todo SQL tool call enters the canonical path with raw SQL preserved for provenance while route selection sees `todo`.

**Verification:**
- Copilot SQL todo tool calls reach the frontend as canonical todo operations before any UI-specific routing runs.

- [ ] **Unit 2: Project Copilot SQL mutations into full todo snapshots**

**Goal:** Maintain a session-scoped backend projection of Copilot todo rows so recognized SQL mutations can emit `normalizedTodos` snapshots.

**Requirements:** R2, R3, R4, R6

**Dependencies:** Unit 1

**Files:**
- Create: `packages/desktop/src-tauri/src/acp/session_update/copilot_todo_sql_projection.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_update.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_update/normalize.rs`
- Modify: existing ACP session teardown/clear path that already cleans session-scoped canonical state
- Test: `packages/desktop/src-tauri/src/acp/session_update/tests.rs`

**Approach:**
- Add a per-session Copilot todo projection store keyed by ACP `sessionId`.
- Persist the parsed todo mutation from the initial `tool_call` by `(sessionId, toolCallId)` so completion updates can apply it even when `tool_call_update` omits `rawInput`.
- Feed completion events plus the pending mutation into the projector during `build_tool_call_update_from_raw(...)`, where the session ID is available.
- Support the bounded SQL row model Copilot currently uses:
  - `id`
  - `title`
  - `description`
  - `status`
- Emit `normalizedTodos` as a full snapshot after each recognized mutation by mapping:
  - `title -> content`
  - `description -> active_form`
  - fallback `active_form = title` when description is absent
  - SQL statuses -> existing canonical todo statuses
- If a recognized `todos` query cannot be safely applied, invalidate the session projector and suppress further “full snapshot” emission until a future bounded reseed strategy exists.
- Wire cleanup into the existing session clear/remove path that already clears session-scoped canonical state so both pending mutations and projected snapshots are removed on close/reset/test teardown.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs`
- `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`
- `packages/desktop/src-tauri/src/acp/session_update/normalize.rs`
- existing ACP session clear/remove path

**Test scenarios:**
- Happy path — an `INSERT INTO todos (...) VALUES (...)` mutation produces a one-item `normalizedTodos` snapshot on completion.
- Happy path — sequential inserts produce a multi-item snapshot in stable list order.
- Happy path — an `UPDATE todos SET status = ... WHERE id = ...` mutation updates the existing snapshot item status without duplicating rows.
- Edge case — a mutation lacking description still produces a valid todo item using `title` as `active_form`.
- Error path — a recognized todo SQL tool call whose row values cannot be parsed leaves `kind: todo` intact for routing, emits no `normalizedTodos`, and invalidates the projector to avoid stale future snapshots.
- Integration — session-scoped projection state is isolated per ACP session and does not leak todos across sessions.
- Integration — a completion update without `rawInput` still produces the correct snapshot because the pending mutation was captured from the initial tool call.

**Verification:**
- A live Copilot SQL todo sequence yields the same `normalizedTodos` shape that existing explicit todo tools already emit.

- [ ] **Unit 3: Converge live Copilot canonicalization with replay expectations**

**Goal:** Ensure the new live SQL-backed todo path matches the replay semantics already exercised by explicit Copilot `update_todos` events.

**Requirements:** R3, R5, R6

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tests.rs`
- Test: `packages/desktop/src-tauri/src/copilot_history/parser.rs`

**Approach:**
- Keep replay behavior unchanged for explicit `update_todos` events.
- Add parity-focused tests that show the live SQL path produces the same canonical `kind: todo` plus `normalizedTodos` shape as replay's explicit todo path.
- Do not modify replay parsing unless implementation proves a tiny shared helper is strictly required.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- `packages/desktop/src-tauri/src/acp/session_update/tests.rs`

**Test scenarios:**
- Happy path — replay `update_todos` and live SQL `INSERT INTO todos` both produce todo tool calls with equivalent `normalizedTodos` payloads for the same logical row.
- Edge case — replay remains unchanged when no SQL-backed live path is involved.
- Integration — live and replay Copilot todo entries both surface as `kind: todo` through the same downstream frontend route expectations.

**Verification:**
- The team can explain Copilot todo behavior once, in canonical terms, instead of separately for replay and live streams.

- [ ] **Unit 4: Add one narrow frontend contract proof if backend tests are insufficient**

**Goal:** Add the smallest possible frontend proof that canonical Copilot todo snapshots route correctly if backend coverage alone does not already prove it.

**Requirements:** R3, R5

**Dependencies:** Unit 3

**Files:**
- Modify one closest consumer test only, if backend coverage is insufficient:
  - `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-definition-registry.test.ts`
  - or `packages/desktop/src/lib/acp/logic/__tests__/todo-state-manager.test.ts`

**Approach:**
- Prefer proving the fix entirely at the backend/canonical contract seam.
- Only if that still leaves routing doubt, add one focused frontend test using a canonical tool-call fixture that mimics the post-backend Copilot SQL todo shape:
  - `kind: "todo"`
  - `normalizedTodos: [...]`
  - raw SQL preserved but ignored by render logic
- Avoid any UI-level SQL parsing; the tests should prove that canonical todo snapshots are sufficient.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/logic/todo-state.svelte.ts`
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-todo.svelte`
- `packages/desktop/src/lib/acp/components/session-list/session-list-logic.ts`

**Test scenarios:**
- Happy path — a canonical Copilot todo tool call routes through the todo-specific registry path or todo snapshot consumer instead of falling back to generic handling.
- Edge case — a canonical completed todo snapshot still routes correctly without any SQL-aware frontend logic.

**Verification:**
- Existing todo UI tests pass using the canonical todo shape without any frontend awareness of Copilot SQL.

## System-Wide Impact

- **Interaction graph:** Copilot ACP parser -> session-update canonicalization -> frontend tool-call routing -> todo snapshot consumers.
- **Error propagation:** Unrecognized or malformed SQL must fail closed to existing generic behavior; recognized todo SQL should only upgrade when the bounded parser is confident.
- **State lifecycle risks:** The new session-scoped todo projector must clean up per-session state and avoid leaking snapshots across sessions or reusing stale rows after session clear.
- **API surface parity:** `ToolCallData` / `ToolCallUpdateData` stay structurally unchanged; the change is in how Copilot populates `kind`, canonical name, and `normalizedTodos`.
- **Integration coverage:** The critical proof is end-to-end canonical parity from live Copilot SQL input to existing todo UI outputs.
- **Unchanged invariants:** Non-todo SQL, explicit replay `update_todos`, and existing todo UI rendering contracts should all remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Copilot emits more SQL variants than the observed log covers | Start with the bounded grammar present in real logs and fail closed for unsupported shapes. Add fixtures as new variants are discovered. |
| Snapshot projection diverges from Copilot's actual session database state | Limit the first pass to bounded `INSERT`/`UPDATE` shapes, persist pending mutations from the initial tool call, and invalidate the projector when a recognized `todos` query cannot be safely applied. |
| Initial todo tool call still routes as `other` because promotion happens too late | Promote identity on the initial tool call in `CopilotParser`, not only during update handling. |
| Frontend timing/progress logic assumes full snapshots, not deltas | Emit full `normalizedTodos` snapshots after each recognized mutation instead of delta payloads. |
| New session-scoped projector leaks state across closes or tests | Bind projector cleanup to the same existing session clear/remove path that already cleans other session-scoped canonical state. |

## Documentation / Operational Notes

- Add the captured Copilot SQL todo shape to provider-conformance fixtures or regression tests so future provider drift fails in a focused place.
- If this lands cleanly, the broader god-clean operation architecture should treat it as a reference example of “provider transport at the edge, canonical semantics inside.”

## Sources & References

- Related code: `packages/desktop/src-tauri/src/acp/parsers/copilot_parser.rs`
- Related code: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs`
- Related code: `packages/desktop/src-tauri/src/acp/session_update/normalize.rs`
- Related code: `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- Related log: `packages/desktop/src-tauri/logs/streaming/469a0bf7-0cc0-41ac-b4d0-06ebfc8433c6.jsonl`
- Related plan: `docs/plans/2026-04-12-002-refactor-god-clean-operation-model-plan.md`

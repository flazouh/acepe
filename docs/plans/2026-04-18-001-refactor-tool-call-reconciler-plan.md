---
title: "refactor: Unified tool-call reconciler with first-class Unclassified variant"
type: refactor
status: superseded
date: 2026-04-18
---

# refactor: Unified tool-call reconciler with first-class Unclassified variant

> Superseded by `docs/plans/2026-04-18-002-refactor-provider-owned-semantic-tool-pipeline-plan.md`. Keep this as transitional context only; do not implement it independently.

## Overview

Replace the fragmented tool-call classification system (three backend modules + one frontend normalization pass + a parallel streaming normalization path) with a **single deterministic reconciler** that produces a closed discriminated union. Add first-class `Sql` and `Unclassified` variants so every frame reaches the UI as an intentional, typed shape — not as `kind: Other` + `name: "Unknown"`.

## Problem Frame

Live debugging of session `aafd454a-ec89-4a71-898e-ed3136a86464` showed the Copilot CLI's built-in `sql` tool rendering as a generic card titled "Mark all done" with a body label `Unknown`. Root cause:

- The CLI emitted `kind: "other"` + no `toolName` + `rawInput: { description, query: "UPDATE todos ..." }`.
- `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs:127` strips the literal string `"unknown"` down to `""`.
- The classifier in `packages/desktop/src-tauri/src/acp/tool_classification.rs` has `has_sql_query_argument` available but **never consults it to actually drive classification** — it only uses it to suppress a web-search false positive.
- Fallthrough lands on `ToolKind::Other` with an empty name, so the UI renders the lowest-common-denominator card.

Structural issues surfaced by that bug:

1. Classification is split across `parsers/adapters/*` (tool-name map), `parsers/kind.rs` (ACP-kind + title + id heuristics), and `tool_classification.rs` (argument-shape precedence resolver). Three modules, three tables, two overlapping sets of heuristics.
2. `ToolKind::Other` is a silent failure — no attached diagnostic signals, no first-class `Unclassified` variant for the UI to render intentionally.
3. Streaming todos/questions go through a separate `streaming_accumulator` normalization path. A non-streamed `TodoWrite` and a streamed one don't share a code path.
4. `ToolKind` couples semantic classification to display labels (`"Run"`, `"Find"`, `"Web Search"` hardcoded in Rust via `canonical_name_for_kind`).
5. Frontend re-normalizes in `packages/desktop/src/lib/services/converted-session-types.ts` — third source of truth.

The cleaner system, per our ASCII design:

```
raw ACP event
    │
    ▼
provider reconciler
classify(event, state)
precedence:
  1. explicit provider name map
  2. argument shape
  3. ACP kind hint
  4. title fallback
  5. Unclassified { signals }
    │
    ▼
closed semantic union (Read | Edit | Execute | Todo | Sql | Browser | ... | Unclassified)
    │
    ▼
projector → UI view
```

Streaming lives inside the reconciler (same state machine, more events), not beside it. Frontend is a consumer of the closed union, not a co-author.

## Requirements Trace

- **R1.** `sql` tool calls (arguments containing a SQL `query` string) classify as `ToolKind::Sql` with a typed `Sql { query?, description? }` arguments variant. Regression case from session `aafd454a` must resolve to `Sql`.
- **R2.** Tool calls that no signal claims reach the UI as `ToolKind::Unclassified` with a typed `Unclassified { raw_name, raw_kind_hint, title, signals_tried, arguments_preview }` variant — never as `Other` + `"Unknown"`.
- **R3.** Classification is a single deterministic function: `reconcile(raw_event, session_state) → (SemanticToolCall, State)`. No scoring, no floats, no probabilistic tie-breaks.
- **R4.** Streaming tool calls (`tool_call_added` → N × `tool_call_delta` → `tool_call_completed`) feed the same reconciler. The `streaming_accumulator` stops holding independent normalization logic for todos/questions — those become reconciler outputs that accumulate in state.
- **R5.** Frontend `converted-session-types.ts` performs zero re-classification. It consumes the typed union produced by the reconciler.
- **R6.** Every existing provider conformance test continues to pass with equal or better classification accuracy. Existing agent parser tests are the characterization gate.
- **R7.** No provider-specific strings remain in shared/agnostic modules outside `reconciler/providers/`. Strings shared by multiple chat-style providers may live in `reconciler/providers/shared_chat.rs`; everything else (`apply_patch`, `str_replace`, `exec_command`, `write_stdin`, etc.) lives inside the owning provider reconciler only.
- **R8.** Desktop session-UI display labels (`"Run"`, `"Find"`, `"Web Search"`) stop coming from Rust. The wire contract carries `ToolKind` as a pure discriminator; label formatting for the desktop app lives in `packages/desktop/src/lib/acp/utils/tool-display-utils.ts`. Full migration into `packages/ui` is deferred.
- **R9.** Emitting `ToolKind::Unclassified` also emits a structured warning to the per-session streaming log so classification misses are observable without replaying the UI.

## Scope Boundaries

**In scope:**
- The tool-call classification/reconciliation pipeline from ACP parser output to the frontend wire contract.
- Rust: `packages/desktop/src-tauri/src/acp/parsers/`, `packages/desktop/src-tauri/src/acp/tool_classification.rs`, `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs`, `packages/desktop/src-tauri/src/acp/streaming_log.rs`, `packages/desktop/src-tauri/src/acp/session_to_markdown.rs`, `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs`, `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs`.
- Frontend: `packages/desktop/src/lib/services/converted-session-types.ts` (generated, but affected by the wire types), `packages/desktop/src/lib/acp/types/tool-kind.ts`, `packages/desktop/src/lib/acp/logic/entry-converter.ts`, any UI call-site that switches on `ToolKind`.

**Out of scope:**
- Visual redesign of tool-call cards. The `Unclassified` card uses the existing generic-tool rendering; only the data feeding it is richer.
- Replacing `ToolKind` with a Rust-side newtype or trait object. We keep it as a flat enum; the "closed union" comes from `ToolArguments` (already variant-carrying) + the new `Unclassified` and `Sql` variants aligned with new `ToolKind` entries.
- Renaming or restructuring unrelated ACP session-update types (content blocks, plan updates, usage).
- Agent-installer, command routing, or anything downstream of session rendering.

### Deferred to Separate Tasks

- **Display-label migration from desktop TS into `packages/ui` (R8 full follow-through).** This plan moves desktop-session label authority out of Rust and into desktop TS, but does **not** yet move the label table into `packages/ui`. That broader cross-app consolidation is a separate task.
- **Frontend renderer consolidation.** Components that currently switch on `ToolKind` will gain an `Unclassified` and `Sql` branch here, but broader cleanup of tool-card rendering is a separate effort.

## Context & Research

### Relevant Code and Patterns

**Classification (to be consolidated):**
- `packages/desktop/src-tauri/src/acp/tool_classification.rs` (604 lines) — the existing deterministic precedence resolver. Already does the "precedence not scoring" thing. Has `ToolClassificationHints`, `resolve_identity_impl`, `infer_kind_from_serialized_arguments`. This is the closest thing to the target architecture today.
- `packages/desktop/src-tauri/src/acp/parsers/kind.rs` (~420 lines) — parallel table of title/kind/id heuristics, hardcodes `apply_patch`, `str_replace`, `exec_command`, browser tool segments, web-search id prefixes.
- `packages/desktop/src-tauri/src/acp/parsers/adapters/shared_chat.rs` — per-name `ToolKind` map shared by Claude/Copilot/Cursor/OpenCode adapters.
- `packages/desktop/src-tauri/src/acp/parsers/adapters/{claude_code,copilot,codex,cursor,open_code}.rs` — currently thin wrappers; should become the *only* place provider-specific knowledge lives.

**Streaming (to be folded in):**
- `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs` — accumulates JSON deltas for `TodoWrite`/`AskUser`/`create_plan` and emits normalized outputs out-of-band.
- `packages/desktop/src-tauri/src/acp/session_update/normalize.rs` — `derive_normalized_questions_and_todos` post-hoc extractor.

**Wire types (to be extended):**
- `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs` — defines `ToolKind` (20 variants) and `ToolArguments` (15 variants, already a discriminated union via `#[serde(tag = "kind")]`). The existing shape already matches the "closed union" target — we just need two more variants and the variant↔kind invariant enforced.
- `packages/desktop/src/lib/services/converted-session-types.ts` — specta-generated TS mirror. Regenerates from Rust.

**Frontend consumers:**
- `packages/desktop/src/lib/acp/logic/entry-converter.ts`, `todo-state-manager.svelte.ts`, `aggregate-file-edits.ts`, `stored-entry-converter.ts` — switch on `ToolKind` or `arguments.kind`.
- `packages/desktop/src/lib/acp/utils/tool-display-utils.ts` — where display labels should ultimately live.

### Institutional Learnings

- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` — prior refactor established the `Operation` abstraction over `ToolCall`. Any new variant added to `ToolArguments` must be reflected in `packages/desktop/src/lib/acp/types/operation.ts` or the derived `OperationKind` type will drift.
- Structural wiring tests that `readFileSync` source code are **forbidden** per AGENTS.md. Wire-level invariants (e.g. "every `ToolArguments` variant has a matching `ToolKind` discriminant") must be enforced by a compiled Rust test using the type, not by grepping source.

### External References

None required. The ACP schema is owned by the repo; the problem is internal.

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| **Deterministic precedence, no scoring.** Order is (1) explicit provider name map → (2) argument-shape classifier → (3) ACP `kind` payload hint → (4) title heuristic → (5) `Unclassified`. First match wins. | User approved this explicitly in session. Scoring is only justified when signals are genuinely ambiguous; ours are not. Precedence is debuggable, testable, and branchless at the decision level. |
| **Argument-shape sits at priority 2, above `kind` hint.** | Providers rename tools but rarely change argument schemas. The `sql` regression is exactly this: `kind: "other"` + `name: "unknown"` + `rawInput.query: "UPDATE ..."` — argument shape is the only reliable signal. |
| **`Unclassified` is a first-class variant, not a null hole.** It carries `raw_name`, `raw_kind_hint`, `title`, `arguments_preview`, `signals_tried: Vec<SignalName>`. | Lets the UI render an intentional fallback and gives us a diagnostic trail in the streaming log for every classification miss. Replaces the silent `Other + "Unknown"` failure mode. |
| **`Sql` becomes a typed variant with `{ query, description? }`.** | SQL tool is first-class in at least Copilot CLI and likely others. Today it's Other + Unknown. Cost is two enum lines + a parser branch. |
| **Single reconciler module owns all classification.** New home: `packages/desktop/src-tauri/src/acp/reconciler/`. Delete `tool_classification.rs` and `parsers/kind.rs`; provider adapters shrink to a `Reconciler` trait impl each. | Three modules → one. Eliminates the provider-knowledge leak in `kind.rs`. |
| **Streaming is state inside the reconciler.** Each provider's `Reconciler` impl holds optional per-tool-call state; `tool_call_added` / `tool_call_delta` / `tool_call_completed` all feed it. `streaming_accumulator.rs`'s todo/question/plan normalization moves inside. | One pipeline instead of two. Non-streamed and streamed todos share a code path. |
| **`ToolKind` stays a flat enum; `ToolArguments` carries variant data.** | `ToolArguments` is already a `#[serde(tag = "kind")]` discriminated union with 15 variants. Adding `Sql` and `Unclassified` is additive. Rewriting to a single `SemanticToolCall` union would churn every UI call-site with no material gain over the existing shape. |
| **Frontend does zero classification.** `converted-session-types.ts` becomes a pure type re-export. Any derived helpers (`tool-display-utils.ts`) read `ToolArguments` variant directly. | Eliminates third-source-of-truth problem in R5. |
| **No backwards-compat bridge.** Per AGENTS.md: "design and plan for the clean replacement architecture directly, with old paths removed rather than accommodated in parallel." `tool_classification.rs`, `parsers/kind.rs`, the standalone streaming normalizers for todos/questions — all deleted in the same PR. | Avoids the three-modules-for-one-job smell returning after partial migration. |

## Open Questions

### Resolved During Planning

- **Q:** Should the reconciler be per-provider (trait impls) or single-shared with a provider-specific name table?
  **A:** Per-provider trait impl. Each provider's `Reconciler` owns its name map + any streaming quirks. Shared argument-shape/kind/title/Unclassified logic lives in a default trait method or shared helper module *without* provider strings.

- **Q:** Does `Unclassified` need to carry the raw ACP payload?
  **A:** No. Carry `raw_name`, `raw_kind_hint`, `title`, `arguments_preview` (truncated JSON, cap ~512 bytes), `signals_tried`. The full raw payload is already in `ToolCallData.raw_input` for debugging.

- **Q:** Should we delete `ToolKind::Other`?
  **A:** No, but narrow its role. `Other` remains only for legacy persisted sessions and explicit generic fallbacks we intentionally preserve. The new reconciler does **not** emit `Other` for classification misses; those become `Unclassified`.

- **Q:** Streaming todos today emit via `normalizedTodos` on `ToolCallData`. Does the new reconciler preserve that field?
  **A:** Yes. `normalizedTodos` is how the todo-card UI reads items. The reconciler produces the same field but via the unified state machine instead of the separate `streaming_accumulator` path. Same wire shape.

- **Q:** Does `canonical_name_for_kind` move entirely out of Rust?
  **A:** No, partial. It stays in Rust only as the helper used by markdown export (`session_to_markdown.rs`). Frontend UI stops consuming it; TS owns its own label table. Full removal is deferred.

- **Q:** Does plan-file streaming move into the reconciler alongside todo/question streaming?
  **A:** No. Todo/question JSON-delta accumulation moves into the reconciler. Plan-file watching stays in `streaming_accumulator.rs` as a narrow utility that keeps owning `PLAN_STREAMING_STATES` / `CODEX_PLAN_STATES` and their cleanup lifecycle.

### Deferred to Implementation

- Exact `SignalName` enum values (e.g. `ProviderNameMap`, `ArgumentShape`, `AcpKindHint`, `TitleHeuristic`) — settle when writing the trait signature.
- Whether the reconciler API is sync (per-event) or returns a `ReconcilerEvent` stream. Sync per-event is the default; revisit only if the folded-in streaming logic forces a batched shape.

## Output Structure

    packages/desktop/src-tauri/src/acp/reconciler/
    ├── mod.rs                  # Reconciler trait, SignalName, shared helpers
    ├── argument_shape.rs       # Argument-shape classifier (ex-infer_kind_from_serialized_arguments)
    ├── unclassified.rs         # Unclassified variant builder + signals_tried tracking
    └── providers/
        ├── mod.rs
        ├── claude_code.rs      # Claude Code Reconciler impl (absorbs adapters/claude_code + CC-specific kind.rs logic)
        ├── codex.rs            # Codex Reconciler impl (absorbs adapters/codex + apply_patch / exec_command knowledge)
        ├── copilot.rs          # Copilot Reconciler impl (absorbs adapters/copilot + update_todos knowledge)
        ├── cursor.rs           # Cursor Reconciler impl
        ├── open_code.rs        # OpenCode Reconciler impl
        └── shared_chat.rs      # shared vocabulary used only by chat-style provider reconcilers

Kept: `packages/desktop/src-tauri/src/acp/parsers/arguments.rs` (shared argument-construction helper reused by the reconciler), `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs` (reduced to plan-file-watching + PLAN/CODEX state cleanup only).

Deleted: `packages/desktop/src-tauri/src/acp/tool_classification.rs`, `packages/desktop/src-tauri/src/acp/parsers/kind.rs`, `packages/desktop/src-tauri/src/acp/parsers/adapters/` (absorbed into `reconciler/providers/`), the todo/question normalization paths inside `streaming_accumulator.rs`.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Reconciler trait shape (pseudo-code):**

```text
trait Reconciler {
    type State

    fn on_tool_call_added(event, state) -> (ToolCallData, state')
    fn on_tool_call_delta(event, state) -> (ToolCallUpdateData, state')
    fn on_tool_call_completed(event, state) -> (ToolCallUpdateData, state')
}

// Shared classification function used by every provider impl:
fn classify(
    provider_name_map: &ProviderNameMap,
    raw: &RawToolCallFrame,
) -> (ToolKind, ToolArguments, Vec<SignalName>) {
    // Precedence, first match wins.
    // `signals_tried` records prior signals that were consulted and did not match.
    // The winning signal is implicit in the returned `ToolKind`.
    signals_tried = []

    if let Some(kind) = provider_name_map.lookup(raw.name) {
        return (kind, build_args(kind, raw), signals_tried);
    }
    signals_tried.push(ProviderNameMap);

    if let Some(kind) = argument_shape::classify(raw.arguments) {
        return (kind, build_args(kind, raw), signals_tried);
    }
    signals_tried.push(ArgumentShape);

    if let Some(kind) = acp_kind_hint::classify(raw.kind_hint, raw.title) {
        return (kind, build_args(kind, raw), signals_tried);
    }
    signals_tried.push(AcpKindHint);

    if let Some(kind) = title_heuristic::classify(raw.title) {
        return (kind, build_args(kind, raw), signals_tried);
    }
    signals_tried.push(TitleHeuristic);

    return (
        ToolKind::Unclassified,
        ToolArguments::Unclassified {
            raw_name: raw.name,
            raw_kind_hint: raw.kind_hint,
            title: raw.title,
            arguments_preview: preview(raw.arguments),
            signals_tried,
        },
        signals_tried,
    );
}
```

**Event flow (unified streaming):**

```text
tool_call_added (frame 1) ─┐
                           │
tool_call_delta (frame 2) ─┼──► Reconciler::on_tool_call_delta(event, per-call state)
                           │          │
tool_call_delta (frame N) ─┘          ▼
                               classify() + accumulate deltas in state
                                       │
tool_call_completed ──────────►        │
                                       ▼
                           ToolCallData / ToolCallUpdateData with:
                             - kind: ToolKind (flat discriminator)
                             - arguments: ToolArguments (typed variant)
                             - normalizedTodos/Questions (if Todo/Question variant)
                             - Unclassified { signals_tried, ... } when nothing matched
```

**The SQL regression resolved end-to-end:**

```text
Input:  { kind: "other", title: "Mark all done", rawInput: { description, query: "UPDATE ..." } }
  │
  ▼ provider_name_map.lookup("") → None
  │
  ▼ argument_shape::classify({ query: "UPDATE ..." }) → matches SQL_KEYWORDS → Some(ToolKind::Sql)
  │
  ▼
Output: ToolCallData {
    kind: Sql,
    arguments: ToolArguments::Sql { query: "UPDATE ...", description: "Mark all done" },
    ...
}
```

UI renders a SQL card with the query preview instead of a generic "Unknown" card.

## Implementation Units

- [ ] **Unit 1: Characterization harness + reproducible SQL fixture**

**Goal:** Lock current provider behavior and extract a committed SQL regression fixture before the new wire variants land.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/parsers/tests/mod.rs` (register any shared fixture helpers needed by characterization tests)
- Create: `packages/desktop/src-tauri/src/acp/parsers/tests/fixtures/copilot_sql_regression.json`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/tests/provider_conformance.rs`

**Approach:**
- Extract a trimmed ACP-frame fixture matching session `aafd454a` SQL frame into a committed JSON fixture: `kind: "other"`, `title: "Mark all done"`, `rawInput: { description: "Mark all done", query: "UPDATE todos SET status='done' ..." }`, `toolName: null`.
- Add characterization tests that lock current outcomes for each provider (Claude Code Read/Edit/Bash, Codex apply_patch/exec_command, Copilot update_todos, etc.) so Unit 4 can't silently regress provider behavior.
- Do **not** add `Sql` / `Unclassified` assertions yet; those variants are introduced in Unit 2 so the regression tests can compile.

**Execution note:** Characterization tests should pass on the current codebase. The red regression step happens at the start of Unit 2, immediately after the new variants exist.

**Patterns to follow:**
- Existing `packages/desktop/src-tauri/src/acp/parsers/tests/claude.rs`, `cursor.rs`, `opencode.rs` for provider-scoped fixtures.
- `provider_conformance.rs` for shape of cross-provider table tests.

**Test scenarios:**
- *Fixture integrity:* The committed fixture reproduces the SQL regression frame from session `aafd454a` without depending on the author's local log directory.
- *Characterization:* Claude Code `Read/Edit/Bash/TodoWrite` still classify identically. Codex `apply_patch`/`exec_command` unchanged. Copilot `update_todos` → `Todo`.

**Verification:**
- `cargo test -p acepe-desktop classification` green. Characterization baseline is locked before any production refactor work.

---

- [ ] **Unit 2: Add `Sql` and `Unclassified` to `ToolKind` + `ToolArguments`, then go red**

**Goal:** Extend the wire contract with the two new variants, update dependent desktop types, then add the compile-safe failing regression tests that drive Units 3-4.

**Requirements:** R1, R2, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/parsers/tests/mod.rs` (add `sql_regression` / `unclassified` modules)
- Create: `packages/desktop/src-tauri/src/acp/parsers/tests/sql_regression.rs`
- Create: `packages/desktop/src-tauri/src/acp/parsers/tests/unclassified.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/arguments.rs` (add `Sql` / `Unclassified` arms in `parse_tool_kind_arguments`)
- Modify: `packages/desktop/src-tauri/src/acp/session_to_markdown.rs` (extend `canonical_name_for_kind` for `Sql` / `Unclassified`)
- Modify: `packages/desktop/src/lib/acp/types/operation.ts`
- Modify: `packages/desktop/src/lib/acp/logic/entry-converter.ts`
- Modify: `packages/desktop/src/lib/acp/logic/aggregate-file-edits.ts`
- Modify: `packages/desktop/src/lib/acp/logic/todo-state-manager.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/utils/tool-display-utils.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte` (only exhaustive-match stubs if needed to keep type-check green; full rendering in Unit 6)
- Modify: `packages/desktop/src/lib/components/ui/session-item/session-item.svelte` (only exhaustive-match stubs if needed to keep type-check green; full rendering in Unit 6)
- Modify: `packages/desktop/src/lib/components/dev/design-system-showcase.svelte` (only exhaustive-match stubs if needed to keep type-check green; full rendering in Unit 6)
- Test: `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs` (inline `#[cfg(test)]` mod for variant↔kind invariant)

**Approach:**
- Add `ToolKind::Sql` and `ToolKind::Unclassified` with `as_str()` entries `"sql"` and `"unclassified"`.
- Add `ToolArguments::Sql { query: Option<String>, description: Option<String> }`.
- Add `ToolArguments::Unclassified { raw_name: String, raw_kind_hint: Option<String>, title: Option<String>, arguments_preview: Option<String>, signals_tried: Vec<String> }`. Keep `signals_tried` as `Vec<String>` for specta-friendly TS codegen; the internal Rust enum is `SignalName` and is stringified at the boundary.
- Update `ToolArguments::tool_kind()` to return `Sql` / `Unclassified` for the new variants.
- Extend `packages/desktop/src/lib/acp/types/operation.ts` so `Operation` / `OperationKind` cover the two new variants in lockstep with `ToolArguments`.
- Extend `canonical_name_for_kind` in `session_to_markdown.rs` so markdown export has explicit `Sql` / `Unclassified` labels while full label-authority migration remains deferred.
- Every frontend switch on `ToolKind` or `ToolArguments.kind` gets new arms. Start with `tool-display-utils.ts`: `Sql` → "SQL", `Unclassified` → derive from `raw_name` if present else "Tool".
- After the new variants compile, add the failing SQL regression and Unclassified tests using the committed fixture from Unit 1. This is the red step for the refactor.
- Run `cargo check`, then `cargo test --lib session_jsonl::export_types::tests::export_types` inside `packages/desktop/src-tauri/`, then `bun run check` — every missing match arm is a compile error and a to-do list.

**Patterns to follow:**
- The existing `ToolArguments::Browser { raw }` variant as a minimal template for Sql's typed shape.
- Existing `#[serde(skip_serializing_if = "Option::is_none")]` pattern on optional fields.

**Test scenarios:**
- *Happy path:* `parse_tool_kind_arguments(ToolKind::Sql, json!({"query": "SELECT 1", "description": "probe"}))` yields `Sql { query: Some("SELECT 1"), description: Some("probe") }`.
- *Happy path:* `parse_tool_kind_arguments(ToolKind::Unclassified, json!({...}))` constructs an `Unclassified` with the expected fields populated from the JSON.
- *Red regression:* SQL fixture from Unit 1 currently still classifies as legacy fallback rather than `Sql`; test fails but compiles.
- *Red regression:* Empty-name / empty-args / `kind: "other"` input currently still classifies as legacy fallback rather than `Unclassified`; test fails but compiles.
- *Invariant:* The two new variants round-trip: `ToolArguments::Sql.tool_kind() == ToolKind::Sql` and `ToolArguments::Unclassified.tool_kind() == ToolKind::Unclassified`. Pre-existing non-round-tripping variants (`PlanMode`, `Think`) are explicitly out of scope for this refactor.
- *Integration:* `Operation` / `OperationKind` can represent both new variants without widening to `any`-style fallbacks.
- *Integration:* specta-generated TS includes both new variants on `ToolKind` and `ToolArguments` after `cargo test --lib session_jsonl::export_types::tests::export_types`.
- *Integration:* `canonical_name_for_kind` returns a non-empty label for `ToolKind::Sql` and `ToolKind::Unclassified`.

**Verification:**
- `cargo check` green across `acepe-desktop` crate.
- `cargo test --lib session_jsonl::export_types::tests::export_types` in `packages/desktop/src-tauri/` regenerates `converted-session-types.ts`.
- `bun run check` green in `packages/desktop`.
- `cargo test -p acepe-desktop classification` runs and shows exactly two failing tests (SQL regression + Unclassified), while all characterization tests from Unit 1 stay green.

---

- [ ] **Unit 3: Build the `reconciler` module with shared classification + first-class `Unclassified` path**

**Goal:** Create the single deterministic classifier used by every provider. No provider strings inside it.

**Requirements:** R1, R2, R3, R7

**Dependencies:** Unit 2

**Files:**
- Create: `packages/desktop/src-tauri/src/acp/reconciler/mod.rs`
- Create: `packages/desktop/src-tauri/src/acp/reconciler/argument_shape.rs`
- Create: `packages/desktop/src-tauri/src/acp/reconciler/unclassified.rs`
- Create: `packages/desktop/src-tauri/src/acp/reconciler/acp_kind.rs` (ACP-kind hint classifier, extracted from `parsers/kind.rs::infer_kind_from_payload`)
- Create: `packages/desktop/src-tauri/src/acp/reconciler/title_heuristic.rs` (title classifier extracted from `parsers/kind.rs`)
- Modify: `packages/desktop/src-tauri/src/acp/mod.rs` (register new module)
- Test: `packages/desktop/src-tauri/src/acp/reconciler/mod.rs` (precedence + SQL priority tests inline)
- Test: `packages/desktop/src-tauri/src/acp/reconciler/argument_shape.rs` (SQL detection, edit-marker detection, etc.)
- Test: `packages/desktop/src-tauri/src/acp/reconciler/unclassified.rs`

**Approach:**
- Define `Reconciler` trait in `reconciler/mod.rs` with a `provider_name_map(&self) -> &ProviderNameMap` method and default-impl `classify(&self, raw: &RawClassificationInput) -> ClassificationOutput`.
- `ProviderNameMap` is a small wrapper over a `&'static [(name, ToolKind)]` slice so provider impls declare their map as `const`.
- `classify` implements the precedence from the High-Level Technical Design section. Each step returns `Option<ToolKind>` and pushes its identifier onto a `signals_tried` builder **only after that signal fails to match**. First `Some(kind)` → build `ToolArguments` for it, return. Fallthrough → `ToolKind::Unclassified` + `ToolArguments::Unclassified { signals_tried, ... }`.
- `argument_shape::classify` absorbs `tool_classification::infer_kind_from_serialized_arguments` **and** promotes `has_sql_query_argument` to return `Some(ToolKind::Sql)` — this is the branch that fixes the regression. SQL classification requires a `query` string whose trimmed value begins case-insensitively with `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER`, or `WITH`. This SQL check runs BEFORE the `description`/`prompt` → `Task` check so `{ description, query: "UPDATE..." }` no longer mis-classifies as `Task`.
- `acp_kind::classify` = subset of `parsers/kind.rs::infer_kind_from_payload` that depends only on ACP-standard `kind`/`title`/`id` values — nothing provider-specific (no `apply_patch`, no `str_replace`, no `exec_command`). Those move to the providers in Unit 4.
- `title_heuristic::classify` = remaining generic title-based inference (e.g., "viewing X" → Read).
- `unclassified::build` produces `ToolArguments::Unclassified` with `arguments_preview` truncated to ~512 bytes, `signals_tried` stringified from an internal `SignalName` enum.
- Web-search promotion and browser-tool promotion live in `reconciler/mod.rs` as final post-classification adjustments — equivalent to today's `apply_web_search_promotion` / browser promotion in `tool_classification.rs`.

**Patterns to follow:**
- Current `tool_classification::resolve_identity_impl` as the precedence-resolver reference — already deterministic, already mostly right. We are distilling it, not inventing it.
- `acp/parsers/mod.rs::AgentType` + `get_parser` dispatch as the parallel for provider-reconciler dispatch.

**Test scenarios:**
- *Happy path:* `classify` on SQL input (`name:""`, `kind_hint:"other"`, `rawInput.query:"UPDATE ..."`) → `ToolKind::Sql`, `signals_tried: [ProviderNameMap]` (matched at argument-shape, so only the prior failed signal is recorded).
- *Happy path:* `classify` on `{ command: "ls" }` with empty name → `ToolKind::Execute`.
- *Happy path:* `classify` on `{ file_path: "...", old_string, new_string }` with empty name → `ToolKind::Edit`.
- *Edge case:* `{ description: "x", query: "UPDATE ..." }` → `Sql`, NOT `Task`. Enforces the priority order of SQL over the generic `description`-implies-Task rule.
- *Edge case:* `{ pattern: "*.rs", file_path: "." }` → `Glob`, not `Search`.
- *Error path:* Empty raw input, empty name, `kind_hint: "other"`, no title → `ToolKind::Unclassified` + `signals_tried: [ProviderNameMap, ArgumentShape, AcpKindHint, TitleHeuristic]`.
- *Integration:* Web-search promotion — input classified as `Fetch` with `id: "ws_abc"` → final `WebSearch`. Browser promotion: `title: "webview_screenshot"` + otherwise-Other → `Browser`.

**Verification:**
- `cargo test -p acepe-desktop reconciler` all green.
- No test in `reconciler/` references any provider-specific tool name (`apply_patch`, `update_todos`, `str_replace`, etc.). Enforced by grep-based test — valid here because it's checking module *inputs*, not implementation, and it's testing a genuine invariant that the provider-knowledge-leak is gone.

---

- [ ] **Unit 4: Port each provider to the `Reconciler` trait; delete `tool_classification.rs` + `parsers/kind.rs` + `parsers/adapters/`**

**Goal:** Move all remaining provider-specific knowledge into `reconciler/providers/<agent>.rs`. Delete the old classification modules. Every call site routes through the new reconciler.

**Requirements:** R3, R6, R7

**Dependencies:** Unit 3

**Files:**
- Create: `packages/desktop/src-tauri/src/acp/reconciler/providers/mod.rs`
- Create: `packages/desktop/src-tauri/src/acp/reconciler/providers/claude_code.rs`
- Create: `packages/desktop/src-tauri/src/acp/reconciler/providers/codex.rs`
- Create: `packages/desktop/src-tauri/src/acp/reconciler/providers/copilot.rs`
- Create: `packages/desktop/src-tauri/src/acp/reconciler/providers/cursor.rs`
- Create: `packages/desktop/src-tauri/src/acp/reconciler/providers/open_code.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs` (replace `resolve_raw_tool_identity` + `classify_raw_tool_call` calls with `get_reconciler(agent).classify(...)`; delete line 127 `"unknown"` patch — reconciler handles it via argument shape or Unclassified)
- Modify: `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs` (swap `classify_serialized_tool_call` import to reconciler equivalent)
- Modify: `packages/desktop/src-tauri/src/acp/parsers/mod.rs` (remove `pub mod adapters` and `pub mod kind`)
- Modify: `packages/desktop/src-tauri/src/acp/mod.rs` (remove `pub(crate) mod tool_classification`)
- Delete: `packages/desktop/src-tauri/src/acp/tool_classification.rs`
- Delete: `packages/desktop/src-tauri/src/acp/parsers/kind.rs`
- Delete: `packages/desktop/src-tauri/src/acp/parsers/adapters/mod.rs`
- Delete: `packages/desktop/src-tauri/src/acp/parsers/adapters/claude_code.rs`
- Delete: `packages/desktop/src-tauri/src/acp/parsers/adapters/codex.rs`
- Delete: `packages/desktop/src-tauri/src/acp/parsers/adapters/copilot.rs`
- Delete: `packages/desktop/src-tauri/src/acp/parsers/adapters/cursor.rs`
- Delete: `packages/desktop/src-tauri/src/acp/parsers/adapters/open_code.rs`
- Delete: `packages/desktop/src-tauri/src/acp/parsers/adapters/shared_chat.rs`

**Approach:**
- Each `providers/<agent>.rs` declares its `ProviderNameMap` as a `const &[(&str, ToolKind)]`. The `shared_chat` map (Claude + Copilot + Cursor + OpenCode's common table) moves into a `providers/shared_chat.rs` helper and each of those four providers composes it with their own extras. This is the only allowed shared-string module because it still lives inside the provider subtree covered by R7.
- Codex's `apply_patch` / `exec_command` / `write_stdin` / `str_replace` knowledge (currently leaked into `parsers/kind.rs`) goes into the Codex provider exclusively.
- Copilot's `update_todos` / `mark_todo` (currently in `shared_chat.rs`) stays in the shared-chat helper since it's actually shared by multiple chat-style providers. The architectural boundary is "no provider strings outside `reconciler/providers/`", not "duplicate identical chat vocabulary four times".
- `session_update/tool_calls.rs`: `build_tool_call_from_raw` and `build_tool_call_update_from_raw` call `reconciler::get_reconciler(agent).classify(...)` instead of the current `resolve_raw_tool_identity` / `classify_raw_tool_call`. The `"unknown"` string patch at line 127 is deleted; if reconciler produces `ToolKind::Unclassified`, the downstream code sees that variant directly.
- Every provider parser test in `parsers/tests/*`, including Unit 2's new `sql_regression.rs` / `unclassified.rs`, either still passes or is adjusted to target the reconciler via a thin adapter. Prefer keeping the tests as-is so they act as a regression harness — add adapters if needed, don't rewrite tests.

**Patterns to follow:**
- Current `parsers/adapters/claude_code.rs` + `parsers/adapters/shared_chat.rs` composition pattern.
- Current provider-dispatch via `get_parser(agent)` in `parsers/mod.rs`.

**Test scenarios:**
- *Characterization:* Every test in `parsers/tests/claude.rs`, `cursor.rs`, `opencode.rs`, `copilot_session_regression.rs`, `provider_conformance.rs`, `future_provider_composition.rs`, `provider_composition_boundary.rs`, `core.rs` continues to pass unchanged. This is the gate — zero regressions.
- *Happy path:* Unit 2's SQL regression test now passes — `get_reconciler(Copilot).classify({name:"", kind_hint:"other", rawInput:{query:"UPDATE..."}})` returns `ToolKind::Sql`.
- *Happy path:* Unit 2's Unclassified test now passes — no-signal input returns `Unclassified` with four entries in `signals_tried`.
- *Integration:* No occurrences of `"apply_patch"`, `"str_replace"`, `"exec_command"`, `"update_todos"`, `"write_stdin"` in `reconciler/mod.rs`, `reconciler/argument_shape.rs`, `reconciler/acp_kind.rs`, `reconciler/title_heuristic.rs`, `reconciler/unclassified.rs`. (Only inside `reconciler/providers/<agent>.rs`.) This is a genuine module-boundary invariant, not a source-structure assertion — fair game for a grep-based test on the `reconciler/` tree excluding `providers/`.
- *Error path:* An unknown future provider name — classifier returns `Unclassified` with `signals_tried` populated; does not panic.

**Verification:**
- `cargo test -p acepe-desktop` full green. All pre-existing parser tests unchanged.
- `cargo clippy --workspace --all-targets -- -D warnings` green.
- `bun run check` in `packages/desktop` green.
- Grep confirms: `tool_classification.rs`, `parsers/kind.rs`, `parsers/adapters/` no longer exist.
- Grep confirms: the five provider-specific strings listed above are absent from shared `reconciler/` files.

---

- [ ] **Unit 5: Fold streaming todo/question normalization into the reconciler state machine**

**Goal:** Eliminate the parallel todo/question normalization path in `streaming_accumulator.rs`. Streamed and non-streamed Todo/Question frames share one code path, while plan-file watching stays separate.

**Requirements:** R4, R6

**Dependencies:** Unit 4

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs` (remove todo/question-specific delta normalization; retain only plan-file-watching + PLAN/CODEX cleanup responsibilities)
- Modify: `packages/desktop/src-tauri/src/acp/session_update/normalize.rs` (collapse `derive_normalized_questions_and_todos` into the reconciler's Todo/Question variant builders; delete if empty)
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs` (replace direct todo/question delta accumulation with reconciler event methods; keep plan-file-watching calls routed through the narrowed utility)
- Modify: `packages/desktop/src-tauri/src/acp/reconciler/mod.rs` (add `on_tool_call_added` / `on_tool_call_delta` / `on_tool_call_completed` default impls with per-session state map)
- Modify: `packages/desktop/src-tauri/src/acp/reconciler/providers/claude_code.rs` (and other providers as needed for provider-specific streaming quirks, e.g., Claude's initial-tool-call-seeds-delta pattern)
- Test: `packages/desktop/src-tauri/src/acp/reconciler/streaming_tests.rs`

**Approach:**
- Reconciler owns a DashMap keyed by `(session_id, tool_call_id)` that stores per-tool accumulator state. Replaces `SESSION_STREAMING_STATES` in `streaming_accumulator.rs`.
- `on_tool_call_added` seeds state with the initial `tool_name` (so subsequent deltas can still classify even if they omit the name — the "effective_tool_name" behavior from today's accumulator).
- `on_tool_call_delta` appends the delta to accumulated JSON, re-runs `classify` once the accumulated JSON parses as a complete object, and — if `ToolKind::Todo` or `Question` — produces `normalizedTodos` / `normalizedQuestions` on the resulting `ToolCallUpdateData`. This replaces the current out-of-band emit path.
- `on_tool_call_completed` finalizes and evicts reconciler-owned state.
- Plan streaming (`process_plan_streaming` / `finalize_plan_streaming_for_tool`) stays in `streaming_accumulator.rs` because it watches filesystem-written plans rather than tool-argument JSON. That narrowed utility continues owning `PLAN_STREAMING_STATES`, `CODEX_PLAN_STATES`, and their cleanup lifecycle.
- Remove `streaming_accumulator::accumulate_delta`; keep a cleanup hook for the remaining plan-state maps so abnormal session termination still evicts plan-related state.

**Patterns to follow:**
- Current `streaming_accumulator::accumulate_delta` for the JSON-delta accumulation algorithm — preserve the logic, relocate it.
- Current `normalize::derive_normalized_questions_and_todos` for shape of the produced `Vec<TodoItem>` / `Vec<QuestionItem>`.

**Test scenarios:**
- *Happy path:* Streamed `TodoWrite` (added → 3 deltas → completed) produces the same `normalizedTodos` on the final `ToolCallUpdateData` as a single non-streamed `TodoWrite` with the same final JSON. Parity test.
- *Happy path:* Streamed `AskUserQuestion` yields identical `normalizedQuestions` to non-streamed.
- *Edge case:* Delta JSON that never parses to a valid object (e.g., truncated on error) — reconciler reports the final `ToolCallUpdateData` with `ToolKind::Unclassified` and `signals_tried` containing the streaming-parse failure as a signal. No panic.
- *Edge case:* Tool call that transitions kind mid-stream (starts looking like Execute from partial JSON, ends as Todo after complete JSON) — final classification reflects completed args, not intermediate guesses.
- *Integration:* End-to-end streaming log for a Claude Code TodoWrite session matches pre-refactor wire output (capture fixture before refactor, replay after).
- *Error path:* Concurrent deltas for the same `(session_id, tool_call_id)` do not corrupt state (DashMap per-shard lock is sufficient; current code has a known deadlock guarded by `drop(session_state)` at `tool_calls.rs:175` — reconciler's API must not reintroduce it).
- *Error path:* Session cleanup still evicts `PLAN_STREAMING_STATES` / `CODEX_PLAN_STATES` even though todo/question accumulation moved into the reconciler.

**Verification:**
- `cargo test -p acepe-desktop streaming` green. Parity test passes.
- `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs` is reduced to only plan-file-watching / plan-state-cleanup responsibilities, with a clear module doc explaining why it remains separate.

---

- [ ] **Unit 6: Frontend consumes the union directly; remove redundant normalization**

**Goal:** `converted-session-types.ts` becomes a pure type re-export. Frontend switches on `ToolArguments.kind` for variant-specific rendering, reads `ToolKind` only as the flat discriminator. `Unclassified` and `Sql` variants render intentionally.

**Requirements:** R5, R8 (partial — label authority moves)

**Dependencies:** Unit 4 (types + wire changes)

**Files:**
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts` (regenerated — verify specta output is clean, no hand edits)
- Modify: `packages/desktop/src/lib/acp/logic/entry-converter.ts`
- Modify: `packages/desktop/src/lib/acp/converters/stored-entry-converter.ts`
- Modify: `packages/desktop/src/lib/acp/logic/todo-state-manager.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/logic/todo-state.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/utils/tool-display-utils.ts` (owns display labels — `Sql → "SQL"`, `Unclassified → arguments.rawName || "Tool"`)
- Modify: `packages/desktop/src/lib/acp/utils/session-to-markdown.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`
- Modify: `packages/desktop/src/lib/components/ui/session-item/session-item.svelte`
- Modify: `packages/desktop/src/lib/components/dev/design-system-showcase.svelte`
- Modify: any agent-panel tool-card renderer that currently switches on `ToolKind`
- Test: `packages/desktop/src/lib/acp/logic/__tests__/entry-converter.test.ts`
- Test: `packages/desktop/src/lib/acp/converters/stored-entry-converter.test.ts`
- Test: `packages/desktop/src/lib/acp/utils/__tests__/tool-display-utils.test.ts`

**Approach:**
- Replace any frontend heuristic that tries to re-classify based on tool name or raw args with a direct switch on `ToolArguments.kind`.
- For unrecognized variants (should not happen post-refactor), fall through to the `Unclassified` card.
- `tool-display-utils.ts` becomes the single desktop-TS authority for display labels; remove any hardcoded label strings elsewhere in components and import from here.
- Sql card: reuse the existing generic tool card shell; show `arguments.query` with basic monospace styling (no syntax highlighting in scope).
- Unclassified card: shows `arguments.rawName` (if present), `arguments.title` (if present), and `arguments.argumentsPreview` in a collapsible section. This is what the SQL bug originally rendered as "Mark all done / Unknown" — it now shows the full diagnostic.
- `session-to-markdown.ts` only gains `Sql` / `Unclassified` support; it does **not** become the new label-authority layer.

**Patterns to follow:**
- Existing `ToolArguments.kind === "browser"` branch in frontend code as a template for `kind === "sql"` / `kind === "unclassified"`.
- Existing generic/fallback tool-card render path.

**Test scenarios:**
- *Happy path:* `entry-converter` on a `ToolArguments::Sql { query, description }` wire payload yields an `Operation` with `arguments.kind === "sql"` and the query/description populated.
- *Happy path:* `tool-display-utils.ts::getToolLabel({ kind: "sql" })` returns `"SQL"`. `getToolLabel({ kind: "unclassified", rawName: "custom_widget" })` returns `"custom_widget"`. `getToolLabel({ kind: "unclassified", rawName: "" })` returns `"Tool"`.
- *Happy path:* Stored-entry-converter round-trips an Unclassified entry losslessly.
- *Integration:* Session-to-markdown export for an `Unclassified` tool call renders a recognizable block (not a blank line).
- *Edge case:* Legacy session replay: a persisted session from before this refactor (with only old ToolKinds on disk) still decodes without error — `Sql` and `Unclassified` are new but additive, so no migration is required. Confirmed with a fixture from an existing session JSONL.
- *Edge case:* Legacy persisted `kind: "other"` entries still render a non-blank generic tool card; `Other` remains a backward-compat wire value distinct from the new `Unclassified` path.

**Verification:**
- `bun run check` green.
- `bun test` green.
- Manual: replay session `aafd454a-ec89-4a71-898e-ed3136a86464` streaming log into the dev app — the ex-"Mark all done / Unknown" tool renders as a SQL card with the `UPDATE todos ...` query.

---

- [ ] **Unit 7: Telemetry + diagnostics for `Unclassified` frames**

**Goal:** Make classification misses visible in logs so we don't accumulate a silent backlog of unmatched frames.

**Requirements:** R9

**Dependencies:** Unit 4

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/reconciler/mod.rs` (emit `tracing::warn!` with `tool_call_id`, `agent`, `raw_name`, `signals_tried` every time `Unclassified` is produced)
- Modify: `packages/desktop/src-tauri/src/acp/streaming_log.rs` (ensure the warn surfaces in the per-session JSONL so we can triage)
- Test: inline in `reconciler/mod.rs`

**Approach:**
- `tracing::warn!` is the minimum bar; no metrics backend in scope. The existing `streaming_log` already captures tracing events for the session, so the warn shows up in `packages/desktop/src-tauri/logs/streaming/<session>.jsonl` naturally.
- Log payload: structured fields `agent`, `tool_call_id`, `raw_name`, `raw_kind_hint`, `title`, `signals_tried` (comma-joined string for readability).

**Patterns to follow:**
- Existing `tracing::debug!` in `session_update/tool_calls.rs::parse_tool_call_from_acp_with_agent` for the structured-fields shape.

**Test scenarios:**
- *Happy path:* Classifying the Unit 2 Unclassified test input emits exactly one warn event with the expected fields (capture via `tracing-test`).
- *Happy path:* Classifying the SQL input (which now resolves to `Sql`) emits **no** warn event.

**Verification:**
- `cargo test` green including the tracing-test capture.

---

- [ ] **Unit 8: Cleanup, documentation, and solutions entry**

**Goal:** Capture this refactor as institutional memory and tidy any loose ends surfaced during Units 1-7.

**Requirements:** R6 (documentation traceability)

**Dependencies:** Units 1-7 complete

**Files:**
- Create: `docs/solutions/architectural/tool-call-reconciler-2026-04-18.md` (with YAML frontmatter: `module: acp`, `tags: [classification, reconciler, tool-calls]`, `problem_type: architecture`)
- Modify: `packages/desktop/src-tauri/src/acp/reconciler/mod.rs` module doc with the precedence order and "no provider strings in shared code" invariant

**Approach:**
- Solutions doc captures: the bug (SQL tool → Unknown), the root-cause chain (3 modules, no Sql variant, silent Other), the fix (precedence classifier + Sql + first-class Unclassified), and the rule going forward ("add a new tool kind via `reconciler/providers/` + `ToolArguments` variant, never by editing shared heuristic code").

**Test scenarios:**
- *Test expectation: none — documentation-only unit.*

**Verification:**
- Solutions doc passes `bun run check` if there's a docs lint (check repo conventions).
- `AGENTS.md` no longer mentions deleted files.

## System-Wide Impact

- **Interaction graph:** Every ACP parser, `session_update::tool_calls`, `streaming_accumulator`, frontend converters, todo/question state managers, markdown export, kanban view, session-item preview, design-system showcase. Blast radius is large but the wire shape (`ToolCallData`) changes only by **addition** (`Sql` and `Unclassified` variants) — no field removals or renames.
- **Error propagation:** Classification never fails — every input reaches some variant. Streaming delta-parse failures currently crash the accumulator in pathological cases; reconciler's contract is that any such failure routes to `Unclassified` with the failure recorded in `signals_tried`.
- **State lifecycle risks:** Streaming per-tool-call state must be evicted on `tool_call_completed` or the DashMap grows unboundedly. Existing accumulator has a deadlock hazard (the `drop(session_state)` before `cleanup_tool_streaming` at `tool_calls.rs:175`) — reconciler API must be designed to make this impossible, not replicate the guard.
- **API surface parity:** Tauri commands that return `ToolCallData` / `ToolCallUpdateData` now may return `kind: "sql" | "unclassified"`. Any TS code that uses `ToolKind` as a closed exhaustive switch must add the two arms or the `bun run check` gate fails — this is the design, not a side effect.
- **Integration coverage:** Replay of a pre-refactor session JSONL through the post-refactor code must produce equivalent or better output (only classification improvements). This is caught by Unit 5's integration parity test and Unit 6's legacy-session-replay edge-case test.
- **Unchanged invariants:** `ToolCallStatus`, `ContentBlock`, `PlanUpdate`, `SessionUsage`, `SkillMeta`, `EditEntry`, `ToolCallLocation`, `QuestionItem`, `TodoItem` — all unchanged. `normalizedTodos` / `normalizedQuestions` fields on `ToolCallData` keep the same shape and semantics; only their producer moves from `streaming_accumulator` to the reconciler.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Classification regression on an edge case no test covers | Unit 1 characterization tests lock current behavior for every provider before any production code changes. Unit 4 explicitly requires all existing parser tests pass unchanged. |
| Streaming state deadlock reintroduced when folding accumulator into reconciler | Unit 5 test scenario explicitly covers concurrent deltas; reconciler API returns events through a method that never holds a DashMap RefMut across state-cleanup calls (documented in the trait contract). |
| Frontend compile explosion when adding `Unclassified` + `Sql` arms to every `ToolKind` switch | Expected and managed — the compiler's exhaustive-match error is the to-do list. `bun run check` gates Unit 2 completion. |
| Plan-file-watching streaming proves hard to separate from JSON-delta accumulation | Unit 5 allows `streaming_accumulator` to persist (renamed) if analysis shows plan-watching is genuinely orthogonal. The decision is made during implementation, not pre-committed. |
| specta TS codegen misses the new variants (build-time regression) | Unit 2 verification explicitly requires `bun run check` green after `cargo check`, which runs the TS export. Catches codegen drift immediately. |

## Documentation / Operational Notes

- `AGENTS.md` updates in Unit 8 to point future contributors at `reconciler/` as the classification entry point and to forbid re-introducing `kind.rs`-style shared heuristic tables.
- New solution note in `docs/solutions/architectural/` captures the refactor rationale and the "new tool kinds go through `ToolArguments` variants, not conditional logic in shared code" rule.
- No rollout concerns — the refactor is internal, no feature flags, no migrations. Desktop app builds ship it as a single step.

## Sources & References

- Debugging session: `/Users/alex/Documents/acepe/packages/desktop/src-tauri/logs/streaming/aafd454a-ec89-4a71-898e-ed3136a86464.jsonl` (SQL regression fixture for Unit 1)
- Current classification modules: `packages/desktop/src-tauri/src/acp/tool_classification.rs`, `packages/desktop/src-tauri/src/acp/parsers/kind.rs`, `packages/desktop/src-tauri/src/acp/parsers/adapters/`
- Current streaming normalization: `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs`, `packages/desktop/src-tauri/src/acp/session_update/normalize.rs`
- Wire contract: `packages/desktop/src-tauri/src/acp/session_update/types/tool_calls.rs` (Rust), `packages/desktop/src/lib/services/converted-session-types.ts` (generated TS)
- Related prior work: `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` (Operation abstraction this refactor must remain compatible with)

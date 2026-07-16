---
status: active
type: refactor
created: 2026-06-11
document_reviewed: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture 2026-06-11 run 2, candidate 1 — top recommendation)
---

# refactor: One authority for tool identity

## Summary

Tool identity — what kind of tool a call is, what it should be named, how its arguments are read — is canonical-model truth, and today it has five entry-point families and one duplicated promotion tree. Consolidate classification behind a single authority interface inside `reconciler/`: one public entry point, provider name-tables as adapters behind it, promotion rules defined exactly once, and the streaming path provably using the same pipeline as the non-streaming path. Behavior-preserving; the existing characterization net is the safety rail.

---

## Problem Frame

Classification today bounces through five layers, and two of them re-implement decisions the others already made:

- `packages/desktop/src-tauri/src/acp/reconciler/mod.rs:62` — `semantic_transition()` (preferred entry: `providers::classify` → `projector::transition_from_classification`).
- `reconciler/mod.rs:99` — `classify_with_provider_name_kind()` runs the signal fallback chain, then post-classification promotions (`apply_todo_sql_promotion`, `apply_web_search_promotion`, `apply_browser_promotion`, ~lines 200–240).
- `reconciler/session_tool.rs` — `resolve_raw_tool_identity` / `classify_raw_tool_call` **re-apply web-search and browser promotion logic**, duplicating the `mod.rs` promotions.
- `acp/streaming_accumulator.rs:224` calls `semantic_transition` per parsed delta, but **also** falls back to `providers::detect_tool_kind` directly at `:209` — a second classification path with different precedence.
- `reconciler/kind_payload.rs` helpers (`infer_kind_from_payload(_for_agent)`, `display_name_for_tool`) are called directly by parsers (`acp/parsers/{claude_code,copilot,cursor,codex}_parser.rs`) and `session_jsonl/display_names.rs:59`, bypassing the engine entirely.

External call-site families (verified):

| Entry | Callers |
|---|---|
| `classify_raw_tool_call` | `session_converter/opencode.rs:373`, `session_converter/fullsession.rs:514`, `acp/inbound_request_router/helpers.rs:112`, `acp/session_update/tool_calls.rs:230,356`, `acp/client/cc_sdk_client/permission_handler.rs:724` |
| `classify_serialized_tool_call` | `acp/session_update/types/tool_calls.rs:489,499` |
| `semantic_transition` | `acp/streaming_accumulator.rs:224` |
| `infer_kind_from_payload(_for_agent)` | 4 parsers + `session_jsonl/display_names.rs` |
| `providers::detect_tool_kind` | `acp/streaming_accumulator.rs:209` |

The deletion test fails for every layer individually: removing any one breaks callers, yet no single module owns tool identity. Adding one promotion rule today means editing `reconciler/mod.rs`, `reconciler/session_tool.rs`, and possibly a provider table.

This consolidation was anticipated: `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md` already assigns one responsibility per module and states "streaming deltas must not invent a parallel classifier." The drift since then is the duplication this plan removes.

---

## Requirements

- R1. One public classification interface; every external call-site family in the table above routes through it (directly or via thin, clearly-marked re-exports).
- R2. Promotion rules (todo-SQL, web-search, browser) are defined exactly once.
- R3. Classification precedence is preserved verbatim: provider name normalization → argument shape → ACP kind hint → title heuristic → explicit `Unclassified { signals_tried }`. Never silent `Other` (per `deterministic-tool-call-reconciler-2026-04-18.md`).
- R4. Streaming and non-streaming inputs provably share the same pipeline: `streaming_accumulator.rs` no longer calls `providers::detect_tool_kind` directly.
- R5. `classify_signals.rs` and `kind_payload.rs` internals become private to the authority; parser-facing helpers remain reachable only through the authority's interface.
- R6. The existing characterization net (`reconciler/tests/` 7 modules, `parsers/tests/sql_regression.rs`, `parsers/tests/unclassified.rs`, `reconciler/providers/mod.rs` inline tests) stays green at every unit boundary.

---

## Scope Boundaries

**Not changing:**
- Classification *semantics* — this is structure-only; any output change is a regression.
- Provider dispatch shape — `providers/mod.rs` keeps its documented "no shared `Reconciler` trait, plain match arm" design.
- `projector.rs` semantics (`transition_from_classification`, `projected_tool_kind`).
- Task reconciliation (`task_reconciler.rs`) — touched only if it calls classification.

### Deferred to Follow-Up Work
- Moving provider classification tables into per-provider adapter homes — plan `2026-06-11-015-refactor-provider-adapter-homes-plan.md`.
- Streaming-state lifecycle ownership (cleanup paths, global statics) — plan `2026-06-11-012-refactor-streaming-state-lifecycle-plan.md`. This plan only changes *which function* the accumulator calls, not its state management.

---

## Context & Research

### Relevant Code and Patterns
- `reconciler/mod.rs:62,99` — the two engine entries; promotions ~:200–240.
- `reconciler/session_tool.rs:48,284,293,330` — `is_unknown_tool_name`, `resolve_raw_tool_identity`, `classify_raw_tool_call`, `classify_serialized_tool_call`.
- `reconciler/classify_signals.rs:11,91,206,250` — kind-hint, argument-shape, title-heuristic, `build_unclassified`.
- `reconciler/kind_payload.rs:14,22,122,154` — payload inference, canonical/display names.
- `reconciler/providers/mod.rs:46,57,71` — `classify`, `detect_tool_kind`, `is_web_search_tool_call_id`.
- `reconciler/tests/mod.rs` — 7 characterization modules with `//!` headers citing what they pin.

### Institutional Learnings
- `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md` — the boundary table this plan re-enforces. Update it on completion.
- `docs/solutions/best-practices/deterministic-tool-call-reconciler-2026-04-18.md` — precedence order and `Unclassified` diagnostics are load-bearing; regression anchors `sql_regression.rs`, `unclassified.rs`.
- `docs/solutions/logic-errors/terminal-state-guard-missing-blocked-2026-04-25.md` — make kind/state matches closed-set so new variants force explicit decisions.

---

## Key Technical Decisions

- **Consolidate inside `reconciler/`, not a new top-level module.** The reconciler already houses 90% of the machinery; a new `tool_classification/` tree would be a rename, not a deepening. The authority is a narrowed public surface over the existing module.
- **The interface is the test surface.** Characterization tests migrate to call only the authority entry points; helper-level tests move inside the module as private-unit tests.
- **Single entry, two shapes.** One function family for raw/serialized tool calls (absorbing `session_tool.rs` entries) and one for streaming transitions (absorbing `semantic_transition`); both funnel into `classify_with_provider_name_kind` so precedence and promotions execute in exactly one place.
- **Parsers keep a payload-inference door, but it's the authority's door.** `infer_kind_from_payload_for_agent` and `display_name_for_tool` remain available to parsers via the authority's public interface; their implementations become private.
- **Glossary addition.** "Tool identity authority" enters `CONTEXT.md` under Canonical model (the module owning tool kind, canonical name, and argument interpretation).

---

## High-Level Technical Design

Directional guidance for review, not implementation specification.

```
            ┌──────────────────────────────────────────────────┐
callers     │      tool identity authority (reconciler/)       │
─────────►  │  classify_raw / classify_serialized / transition │
 parsers,   │        │                                          │
 converters,│        ▼ one funnel                               │
 router,    │  provider tables → signals → promotions → kind   │
 accumulator│  (adapters)        (private)   (defined once)    │
            └──────────────────────────────────────────────────┘
```

---

## Implementation Units

### U1. Baseline the characterization net across all five entry families

**Goal:** Prove current behavior is pinned before moving anything.
**Requirements:** R3, R6
**Dependencies:** none
**Files:**
- Test: `packages/desktop/src-tauri/src/acp/reconciler/tests/` (extend existing modules)
- Test: `packages/desktop/src-tauri/src/acp/parsers/tests/` (verify coverage, extend if gaps)

**Approach:** Audit the 7 reconciler test modules + parser regression suites against the call-site table in Problem Frame. Add pins where a family lacks coverage — especially `session_tool.rs` promotion behavior (the duplicated tree) and streaming-vs-non-streaming parity for the same tool input.
**Execution note:** Characterization-first — pin what exists, including any behavior that looks wrong; do not fix while pinning.
**Test scenarios:**
- Same raw tool input classified via `classify_raw_tool_call` and via streaming `semantic_transition` yields the same kind and canonical name (parity pin).
- A web-search-shaped tool routed through `session_tool.rs` and through `mod.rs` promotions produces identical promotion results (duplication pin — this is the bug surface).
- Unknown tool name with no signals yields `Unclassified` with non-empty `signals_tried`, never `Other`.
- Provider-specific names (one per provider table) classify to their documented kinds.

**Verification:** Every entry family in the call-site table has at least one test that fails if its output changes.

### U2. Define the authority interface

**Goal:** One narrow public surface; everything else `pub(crate)`-or-tighter behind it.
**Requirements:** R1, R3
**Dependencies:** U1
**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/reconciler/mod.rs`
- Test: `packages/desktop/src-tauri/src/acp/reconciler/tests/` (tests now target the authority)

**Approach:** Declare the public entry set (raw, serialized, streaming-transition, payload-inference, display-name) on `mod.rs`, delegating to the existing engine. No behavior change — this unit only names the interface and re-routes internal calls. Document the precedence contract in the module header.
**Test scenarios:**
- Each public entry point returns identical output to its pre-existing equivalent for a fixture set spanning all providers (golden parity per entry).

**Verification:** `cargo test` green; authority module header documents precedence and the never-silent-`Other` contract.

### U3. Fold `session_tool.rs` promotions into the shared engine

**Goal:** Delete the duplicated promotion tree.
**Requirements:** R2
**Dependencies:** U2
**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/reconciler/session_tool.rs`
- Modify: `packages/desktop/src-tauri/src/acp/reconciler/mod.rs`

**Approach:** `resolve_raw_tool_identity` / `classify_raw_tool_call` become thin callers into the funnel; their bespoke web-search/browser promotion code is deleted. If the duplicate trees disagree on any fixture (U1 will have surfaced this), resolve toward the `mod.rs` engine and record the delta in the plan's verification notes.
**Test scenarios:**
- The U1 duplication pin now passes through a single code path (assert by behavior: identical outputs; the dead branch is gone per coverage/grep).
- All existing `session_tool` callers (converters, router, tool_calls, permission handler) produce unchanged classifications on the U1 fixture set.

**Verification:** `rg 'apply_web_search_promotion|apply_browser_promotion' src-tauri/src/acp/reconciler/` shows exactly one definition site and engine-internal calls only.

### U4. Route the streaming accumulator through the authority only

**Goal:** Streaming uses the same pipeline as non-streaming; no direct provider-table fallback.
**Requirements:** R4
**Dependencies:** U2
**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/streaming_accumulator.rs`
- Test: `packages/desktop/src-tauri/src/acp/reconciler/tests/streaming_semantic_characterization.rs`

**Approach:** Replace the `providers::detect_tool_kind` fallback at `:209` with the authority's streaming-transition entry; the cached-name kind-upgrade logic in `seed_tool_name` consumes authority output instead of re-deriving. Coordinate with plan 012 (which restructures this file's state management) — this unit changes call targets only.
**Test scenarios:**
- Streaming a tool whose name arrives only in the seed event (deltas say "unknown") classifies identically to the non-streamed equivalent.
- Kind upgrade path (`Other` → specific) still occurs at the same delta boundary as today.

**Verification:** `rg 'detect_tool_kind' src-tauri/src/acp/ --glob '!reconciler/**'` returns nothing.

### U5. Narrow helper visibility and migrate the parser-facing door

**Goal:** `classify_signals.rs` and `kind_payload.rs` stop being public seams.
**Requirements:** R5
**Dependencies:** U3, U4
**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/reconciler/{classify_signals.rs,kind_payload.rs,mod.rs}`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/{claude_code_parser.rs,copilot_parser.rs,cursor_parser.rs,codex_parser.rs}`
- Modify: `packages/desktop/src-tauri/src/session_jsonl/display_names.rs`

**Approach:** Parsers and `display_names.rs` switch their `infer_kind_from_payload(_for_agent)` / `display_name_for_tool` imports to the authority's re-exports; helper modules drop to private visibility. Compiler-driven migration.
**Test scenarios:**
- Test expectation: none beyond compilation + existing suites — pure visibility/import migration with no behavior change; parser snapshot tests (`parsers/tests/snapshots/`) are the regression net.

**Verification:** Helpers are not importable outside `reconciler/`; `cargo clippy` and full test suite green.

### U6. Clearance, glossary, and learning refresh ✅

**Goal:** Make the consolidation durable.
**Requirements:** R1, R6
**Dependencies:** U5
**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`

**Approach:** Grep clearance scans (no classification calls outside the authority); add "tool identity authority" to `CONTEXT.md`; refresh the 2026-04-18 pipeline doc's boundary table to the new shape (or run docs/solutions refresh on it).
**Test scenarios:**
- Test expectation: none — documentation and clearance unit.

**Verification:** Clearance greps clean; glossary and pipeline doc reflect the single-authority shape.

---

## System-Wide Impact

- **Session converters, inbound router, permission handler, parsers** — import-path changes only; behavior pinned by U1.
- **Plan 015 (provider adapter homes)** — consumes this plan's result; classification tables stay in `reconciler/providers/` until 015 decides their home.
- **Plan 012 (streaming lifecycle)** — touches the same `streaming_accumulator.rs`; U4 here is call-target-only to keep the merge surface small. Land U4 before 012 starts or rebase 012 on it.

### Batch 009–015 sequencing (recommended)

| Order | Plan | Gate |
|---|---|---|
| 1 | `2026-06-11-005` → `2026-06-11-014` | Typed `ScenePatch` before conversation-builder seal |
| 2 | `2026-06-11-008` → `2026-06-11-010` | Envelope routing split before registry ledger split |
| 3 | `2026-06-11-009` U4 → `2026-06-11-012` | Classification call-target change before streaming lifecycle |
| 4 | `2026-06-11-009` (full) → `2026-06-11-015` | Tool identity authority before provider homes |
| 5 | `2026-06-11-011`, `2026-06-11-013` | Independent; soft rebase if U5 (011) and U2 (013) overlap in time |

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| The duplicated promotion trees disagree on some input (latent bug) | U1 parity pins surface disagreements before code moves; resolve explicitly toward the engine, record the delta |
| Streaming parity regression (kind flicker mid-stream) | `streaming_semantic_characterization.rs` extended in U1/U4; same-pipeline funnel makes divergence structural, not incidental |
| Merge conflicts with plan 012 on `streaming_accumulator.rs` | Sequence U4 before 012 begins; both plans note the shared file |
| Visibility narrowing breaks an unnoticed caller | Compiler-driven; U5 is mechanical with full-suite verification |

---

## Sources & References

- Architecture review 2026-06-11 run 2, candidate 1 (top recommendation)
- `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`
- `docs/solutions/best-practices/deterministic-tool-call-reconciler-2026-04-18.md`
- Related plans: `2026-06-11-012` (streaming lifecycle), `2026-06-11-015` (provider adapter homes)

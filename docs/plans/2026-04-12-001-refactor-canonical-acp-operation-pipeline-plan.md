---
title: Refactor ACP operation pipeline around canonical operation semantics
type: refactor
status: active
date: 2026-04-12
---

# Refactor ACP operation pipeline around canonical operation semantics

## Overview

Replace the current hybrid ACP pipeline with a single canonical operation model that all providers decode into and all UI surfaces consume. The goal is to stop reconstructing semantics from transport-shaped tool payloads in multiple places and make behaviors like todos, questions, permissions, tasks, search, and plan approval first-class domain operations rather than special-case parser and UI heuristics.

## Problem Frame

Acepe already trends toward provider-owned semantics at the edge, but the ACP pipeline still splits meaning across parser hints, tool classification, session update enrichment, operation storage, and UI projection. The recent Copilot todo work exposed the smell clearly: provider SQL needed backend special-casing, then the desktop scene and shared tool-kind mapping still had enough duplicated routing logic to let raw SQL leak into presentation.

The deeper problem is not Copilot SQL itself. The problem is that operation semantics are still partly inferred from raw transport shape after the provider boundary. That creates drift between:

- provider adapters
- tool classification and session update code
- persisted operation records
- derived read models (`normalizedTodos`, `normalizedQuestions`, permissions, task children)
- desktop scene mapping and tool renderer routing

This refactor should make the canonical operation layer the only semantic authority below the provider adapter boundary.

## Requirements Trace

- R1. Provider-specific transport quirks must terminate at provider adapters or canonical operation decoders, not leak into shared UI or scene projection logic.
- R2. Every tool-like event must resolve into one canonical operation semantic family or explicitly fail closed as unknown.
- R3. Derived read models such as todos, questions, permissions, and task projections must be produced from canonical operation semantics rather than raw payload reinspection in multiple downstream layers.
- R4. Replay, persistence, and session resume must restore the same canonical semantics as live streaming.
- R5. Desktop and shared UI surfaces must render from canonical operation projections, not from duplicated tool-kind or raw-argument heuristics.
- R6. The refactor must preserve reviewability: raw provider payloads remain inspectable as evidence, but they are not the semantic source of truth.

## Scope Boundaries

- Not a product-feature redesign of the agent panel or kanban UX.
- Not a full provider capability redesign unrelated to ACP operations.
- Not a one-off Copilot-only fix; the plan targets the shared ACP operation pipeline across tool kinds.

### Deferred to Separate Tasks

- Provider-specific cleanup outside ACP operation flow (for example model selection or preconnection command loading) unless directly touched by canonical operation contracts.
- Visual redesign of tool cards after semantic routing is corrected.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/acp/parsers/copilot_parser.rs` currently mixes provider-edge parsing with fallback kind inference.
- `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs` still derives normalized state during update reconciliation instead of consuming a single canonical semantic projector.
- `packages/desktop/src/lib/services/converted-session-types.ts` defines shared `ToolKind` and derived content types consumed by desktop.
- `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts` and `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts` both participate in semantic routing and display shaping.
- Existing operation ownership already exists as prior art in the operation/interactions work under `packages/desktop/src/lib/acp/store/`.

### Institutional Learnings

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` reinforces the core boundary: provider-owned meaning should travel as typed contracts, not be reconstructed from UI-facing projections.
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` shows the right architectural instinct: canonical ownership belongs below the UI boundary, with one read model feeding many projections.

### External References

- None required. The repo already contains enough architectural prior art for this refactor.

## Key Technical Decisions

- **Introduce a canonical operation decoder layer between provider adapters and session update reconciliation:** this becomes the single place where raw provider events become semantic operation records.
- **Split operation semantics from presentation tool kinds:** `ToolKind` can remain a display-facing grouping, but it should be derived from canonical semantics rather than serving as the semantic source of truth.
- **Model read and write semantics explicitly for all operation families:** todos, questions, permissions, tasks, plan approval, search, fetch, edits, and browser actions each need a canonical semantic shape with clear live/replay parity.
- **Move derived snapshot production into canonical projectors:** `normalizedTodos`, `normalizedQuestions`, task child summaries, and similar projections should come from operation-family projectors rather than from scattered `tool_call_update` helpers.
- **Preserve raw payloads as evidence only:** canonical operations keep links to raw provider payloads for debug/review, but downstream code should not need to reinterpret them for semantics.
- **Assume clean replacement, not coexistence architecture:** old heuristic routing paths are removed once the canonical layer covers the operation families they currently serve.

## Open Questions

### Resolved During Planning

- **Should this plan target only todo canonicalization or the whole ACP pipeline?** Whole ACP operation pipeline across tool kinds.
- **Should work happen from the main checkout?** Yes. The implementation should land in the main git directory directly.
- **Should the design preserve today’s layered heuristic coexistence for safety?** No. Follow the repo rule to plan for the clean replacement architecture directly.

### Deferred to Implementation

- **Exact Rust type names and module split for canonical operation families:** this depends on how the existing `session_update`, `tool_classification`, and projection modules collapse most cleanly in code.
- **Whether the final reducer lives inside `session_update`, `operation-store`, or a new `semantic_projection` module:** this should be chosen during implementation once the concrete mutation surfaces are updated together.
- **Exact migration sequence for existing tests:** the plan defines coverage targets, but final test file changes depend on which current tests best express the new boundaries.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
BEFORE

Provider transport event
        |
        v
+---------------------------+
| Provider adapter          |
+---------------------------+
        |
        v
+---------------------------+
| Parser + kind inference   |
| + shared classification   |
+---------------------------+
        |
        v
+---------------------------+
| Session update enrichment |
| - ad hoc normalizedTodos  |
| - ad hoc normalizedQs     |
+---------------------------+
        |
        +-------------------------+
        |                         |
        v                         v
+-------------------+   +----------------------+
| Stored operations |   | Raw payload fallback |
| (partly semantic) |   | in UI / scene        |
+-------------------+   +----------------------+
        |                         |
        +------------+------------+
                     |
                     v
           +----------------------+
           | Desktop scene mapper |
           | + tool router        |
           | + raw heuristics     |
           +----------------------+
                     |
                     v
           +----------------------+
           | Shared UI            |
           | specialized or       |
           | fallback cards       |
           +----------------------+


AFTER

Provider transport event
        |
        v
+---------------------------+
| Provider adapter          |
| - Copilot quirks          |
| - Claude quirks           |
| - shared-chat quirks      |
+---------------------------+
        |
        v
+---------------------------+
| Canonical operation       |
| decoder                   |
|                           |
| ReadFile   EditFile       |
| Execute    Search         |
| Fetch      WebSearch      |
| TodoRead   TodoWrite      |
| Question   Task           |
| Plan*      Browser        |
| Unknown    fallback       |
+---------------------------+
        |
        v
+---------------------------+
| Operation-family          |
| projectors                |
|                           |
| TodoProjector             |
| QuestionProjector         |
| InteractionProjector      |
| TaskProjector             |
| PresentationProjector     |
+---------------------------+
        |
        +----------------------+
        |                      |
        v                      v
+-------------------+   +-------------------+
| Persisted         |   | Live session      |
| canonical ops     |   | derived state     |
+-------------------+   +-------------------+
        |                      |
        +----------+-----------+
                   |
                   v
         +----------------------+
         | Replay / resume      |
         | restore              |
         +----------------------+
                   |
                   v
         +----------------------+
         | Desktop scene mapper |
         | + tool routing       |
         +----------------------+
                   |
                   v
         +----------------------+
         | Shared presentational|
         | UI components        |
         +----------------------+
```

The important change is the seam: provider transport shape is decoded once into canonical operation semantics, and every downstream projection consumes that semantic layer instead of reinterpreting raw payloads or heuristic display kinds.

## Implementation Units

- [x] **Unit 1: Define the canonical operation semantic model**

**Goal:** Introduce a shared semantic contract for ACP operations that distinguishes operation family, intent, and projection inputs independently from provider transport shape.

**Requirements:** R1, R2, R6

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/types.rs`
- Modify: `packages/desktop/src-tauri/src/acp/tool_classification.rs`
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts`
- Test: `packages/desktop/src-tauri/src/acp/session_update/tests.rs`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-definition-registry.test.ts`

**Approach:**
- Define canonical operation families explicitly enough to cover all existing tool-like behaviors.
- Separate semantic operation family from display grouping so downstream code can render from semantics while still collapsing display kinds where appropriate.
- Ensure unknown or unsupported shapes fail closed into a deliberate unknown/other family instead of silent heuristic drift.

**Patterns to follow:**
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`
- Existing operation ownership seams in `packages/desktop/src/lib/acp/store/`

**Test scenarios:**
- Happy path: known provider tool payloads for read/edit/execute/search/todo/question/task decode into the expected canonical operation family.
- Edge case: provider emits missing tool name but includes enough raw payload shape to resolve the canonical family.
- Error path: ambiguous payload that matches no supported family resolves to explicit unknown/other rather than a misleading semantic family.
- Integration: converted shared types preserve the canonical family needed by desktop renderers without transport-specific branching.

**Verification:**
- A single canonical semantic family can be identified for every supported tool-like event without consulting UI routing code.

- [x] **Unit 2: Move provider-specific interpretation to adapter-owned decoders**

**Goal:** Make provider adapters responsible for decoding raw transport quirks into canonical operations so shared ACP runtime code stops inferring provider meaning from generic payload structure.

**Requirements:** R1, R2, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/parsers/copilot_parser.rs`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/adapters/shared_chat.rs`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/arguments.rs`
- Modify: `packages/desktop/src-tauri/src/acp/parsers/types.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_update/tests.rs`

**Approach:**
- Replace today’s layered inference chain with adapter-owned decoding into canonical operation families.
- Keep provider-specific raw payload handling close to the adapter, including Copilot SQL-backed todo semantics and any equivalent provider quirks for other families.
- Ensure both initial `tool_call` and later `tool_call_update` events resolve through the same canonical decode rules.

**Execution note:** Start with characterization coverage around existing provider payload shapes before deleting fallback heuristics.

**Patterns to follow:**
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`

**Test scenarios:**
- Happy path: Copilot, Claude, and existing shared-chat tool events decode into the same canonical operation families for equivalent behavior.
- Edge case: missing tool names, kind hints, or partial update payloads still resolve correctly when the adapter has enough provider context.
- Error path: unsupported provider payloads remain inspectable but do not impersonate another operation family.
- Integration: initial call plus completion update preserve the same canonical family across live streaming.

**Verification:**
- Shared runtime code no longer needs provider-specific transport heuristics to decide semantic operation family.
- Done in root `main`: provider parsers now emit canonical semantic families into raw tool-call inputs/updates, session-update builders prefer parser-owned families when resolving public tool kinds, and ACP-path regressions cover Copilot todo SQL read/write behavior through both `parse_tool_call_from_acp` and `parse_tool_call_update_from_acp`.

- [x] **Unit 3: Centralize operation-family projectors for derived read models**

**Goal:** Produce `normalizedTodos`, `normalizedQuestions`, task summaries, and related derived state from canonical operation-family projectors instead of scattered update-time helpers.

**Requirements:** R3, R4, R6

**Dependencies:** Units 1-2

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_update/deserialize.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Create: `packages/desktop/src-tauri/src/acp/operation_projectors/`
- Test: `packages/desktop/src-tauri/src/acp/session_update/tests.rs`
- Test: `packages/desktop/src-tauri/src/acp/*projector*.rs` (new focused projector tests)

**Approach:**
- Introduce one projector per operation family or a small grouped projector layer with explicit ownership.
- Todo reads and writes should both feed the same todo projector; questions should do the same for question projection, and so on.
- Resume and replay should rebuild projector state from canonical operations, not from special-case transport reconstruction.

**Technical design:** Treat projector state as a canonical read model cache keyed by session and operation family, with resume rebuilding from persisted canonical operations.

**Patterns to follow:**
- Existing session restore patterns in `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Operation ownership principles from `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`

**Test scenarios:**
- Happy path: todo writes and todo reads both emit the same canonical todo snapshot shape.
- Edge case: completion updates without `rawInput` still project correctly when canonical operation evidence was stored on the initial call.
- Error path: unsupported operation payload invalidates only the affected projector family and fails closed.
- Integration: session resume restores projector state identical to live accumulation.

**Verification:**
- Derived normalized state comes from canonical projectors, and replay/resume matches live behavior.
- Done in root `main`: `acp/operation_projectors` now owns normalized todo/question derivation plus OpenCode task-summary child projection, and the live parser, replay/import converters, streaming accumulator, converted question-interaction projection, and OpenCode SSE/converter paths all consume the shared projector helpers instead of reconstructing those read models ad hoc.

- [x] **Unit 4: Refactor persistence and replay around canonical operations**

**Goal:** Ensure stored operation snapshots and replay restoration preserve canonical semantics directly, so the pipeline behaves the same live and after reload.

**Requirements:** R4, R6

**Dependencies:** Units 1-3

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/projections.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/copilot.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/cursor_session_update_enrichment.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_update/tests.rs`
- Test: `packages/desktop/src-tauri/src/acp/projections/tests.rs` or equivalent existing projection tests

**Approach:**
- Persist canonical operation family and canonical projector inputs as first-class snapshot fields.
- Remove replay-time dependence on raw provider output where canonical semantics were already known earlier in the pipeline.
- Keep raw payloads only for debug/audit inspection.

**Patterns to follow:**
- Projection restore approach already used by operation/interactions work

**Test scenarios:**
- Happy path: persisted operations restore the same semantic family and derived projections after session reload.
- Edge case: partially completed sessions with pending operations restore pending projector state accurately.
- Error path: old or incomplete persisted records degrade to explicit unknown semantics instead of corrupting a projector.
- Integration: live session, persisted snapshot, and restored session produce the same visible todo/question/task state.

**Verification:**
- Replay and resume no longer need transport-shaped heuristics to recover operation meaning.
- Done in root `main`: `OperationSnapshot` now stores optional `semantic_family`, projection updates preserve the original family after initial tool-call creation, ACP type export emits `OperationFamily` before `OperationSnapshot`, and projection regressions prove todo SQL reads survive live update completion, restored snapshots, and legacy snapshot deserialization without semantic corruption.

- [x] **Unit 5: Simplify desktop scene and renderer routing to consume canonical semantics only**

**Goal:** Remove duplicated semantic routing from scene mapping and tool renderer layers so presentation becomes a pure consumer of canonical operation projections.

**Requirements:** R5, R6

**Dependencies:** Units 1-4

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/resolve-tool-operation.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-kind-to-agent-tool-kind.ts`
- Modify: `packages/ui/src/components/agent-panel/types.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.test.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/build-agent-tool-entry.test.ts`

**Approach:**
- Make scene/renderer selection a straightforward mapping from canonical operation family plus precomputed projection data.
- Remove raw-argument and raw-result inspection from desktop scene mapping where canonical projection data already exists.
- Keep shared UI components dumb and presentation-only.

**Patterns to follow:**
- MVC guidance in `AGENTS.md`
- Existing `@acepe/ui` separation for the agent panel

**Test scenarios:**
- Happy path: canonical todo/question/task/search operations render the expected specialized cards from semantic data only.
- Edge case: unknown operations render a deliberate fallback card while preserving debug details.
- Error path: a failed operation still renders the correct specialized card family with failure state rather than falling back to unrelated semantics.
- Integration: the same canonical operation renders consistently in transcript, queue, kanban, and session list projections.

**Verification:**
- Presentation routing no longer depends on provider transport shape or duplicated semantic heuristics.
- Done in root `main`: `desktop-agent-panel-scene.ts` now sources shared row fields and normalized todo/question payloads from `tool-definition-registry` via `resolveFullToolEntry`, `tool-kind-to-agent-tool-kind.ts` preserves canonical `question` semantics into the shared UI layer, and the scene keeps only view-local status/search/web/fetch/lint shaping instead of rebuilding semantic routing.

- [x] **Unit 6: Remove superseded heuristic seams and harden cross-surface regression coverage**

**Goal:** Delete the old multi-layer fallback logic once the canonical pipeline covers all supported tool families, and lock the new boundary with cross-surface regression tests.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** Units 1-5

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/tool_classification.rs`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/`
- Modify: `packages/desktop/src/lib/acp/store/`
- Test: `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/operation-interaction-parity.contract.test.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/operation-store.vitest.ts`

**Approach:**
- Delete fallback semantic reconstruction that only existed to compensate for missing canonical contracts.
- Add cross-surface regression tests that prove transcript, queue, kanban, permissions, and replay all agree on the same canonical operation semantics.
- Keep a narrow, explicit fallback path for truly unknown operations only.

**Execution note:** Characterization coverage should be added before deleting broad heuristic paths that currently mask semantic drift.

**Patterns to follow:**
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`

**Test scenarios:**
- Happy path: one logical operation family resolves identically across all major UI projections.
- Edge case: provider-specific odd payloads that used to rely on heuristics now remain correct via the canonical decoder.
- Error path: unsupported operations stay unknown without corrupting known operation-family projectors.
- Integration: permission/question/task/todo surfaces remain consistent with transcript rows after live updates and restored sessions.

**Verification:**
- The ACP pipeline has one semantic authority, and removing heuristic seams does not change supported visible behavior.
- Done in root `main`: cross-surface parity coverage now proves canonical question semantics survive `resolveToolOperation`, `resolveFullToolEntry`, and compact display builders; the desktop scene consumes shared todo/question payloads instead of rebuilding them locally; shared UI kinds now preserve `question`; and duplicate indexed file paths are deduped before file-tree flattening so session-list rendering cannot crash on repeated paths.

## System-Wide Impact

- **Interaction graph:** provider adapters, session update parsing, canonical operation storage, projector state, replay restoration, desktop scene mapping, and shared tool renderers all change together.
- **Error propagation:** semantic decode failures should stay explicit at the canonical operation boundary and fall into deliberate unknown/fallback behavior instead of leaking as misleading specialized UI.
- **State lifecycle risks:** replay/live parity, pending operation restoration, and invalidation of projector state are the highest-risk lifecycle seams.
- **API surface parity:** Rust ACP runtime types and TypeScript converted session types must remain aligned through the refactor.
- **Integration coverage:** transcript, queue, kanban, permission bar, and restored-session flows all need parity coverage because they currently consume overlapping operation meaning.
- **Unchanged invariants:** raw provider payloads remain available for debugging/review, and the UI remains presentational rather than provider-aware.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Canonical model grows too abstract and obscures concrete provider behavior | Keep operation families grounded in current supported behaviors and preserve raw payload evidence alongside canonical semantics |
| Refactor breaks replay/resume parity | Add explicit live vs restored regression coverage before deleting heuristic restore logic |
| UI surfaces drift during migration | Route all surfaces through shared canonical projections before removing old paths |
| Tool classification cleanup removes necessary edge-case handling prematurely | Characterize existing odd payloads first, then replace with adapter-owned canonical decoders |

## Documentation / Operational Notes

- Update relevant ACP architecture docs once the canonical operation layer lands so future fixes do not reintroduce UI-side semantic reconstruction.
- The eventual implementation should land from the main checkout, not a side worktree, per current user preference.

## Sources & References

- Related code: `packages/desktop/src-tauri/src/acp/parsers/copilot_parser.rs`
- Related code: `packages/desktop/src-tauri/src/acp/session_update/tool_calls.rs`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`
- Related code: `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts`
- Related code: `packages/desktop/src/lib/services/converted-session-types.ts`
- Institutional learning: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- Institutional learning: `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`

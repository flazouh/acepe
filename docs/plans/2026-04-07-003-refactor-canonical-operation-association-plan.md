---
title: refactor: Introduce canonical operation association layer
type: refactor
status: completed
date: 2026-04-07
---

# refactor: Introduce canonical operation association layer

## Overview

Introduce a canonical operation layer between provider transport and Acepe's UI projections so tool executions become durable domain objects with stable association to permissions, questions, and plan approvals. The goal is to stop provider-emitted transport IDs from determining frontend ownership and instead resolve tool/interactions once in a shared domain layer that transcript, queue, kanban, notifications, and tab state can project from without ad-hoc matching.

## Problem Frame

The interaction-store refactor removed the biggest split-brain issues for questions and plan approvals, but the `097a8f1a-efc9-4aee-89e8-770946bb7ab4` Copilot session exposed the next architectural seam. One logical execute operation appeared twice in the UI because:

- the real execute tool call used one ID (`call_*`)
- the permission request for the same command used a different synthetic anchor (`shell-permission`)

The current fix collapses that case with semantic command matching in frontend-adjacent code, but that is still a smell: provider transport identity is leaking into store/component association logic. If left there, the same class of bug will keep reappearing with different provider quirks, replay order differences, or future interaction shapes.

Acepe's stated direction is agent-agnostic architecture with provider quirks pushed to adapters and edges. This phase should make that true for operation/interation association: the frontend should render resolved domain state, not decide at render time whether two transport artifacts belong together.

## Requirements Trace

- R1. Tool executions must have one canonical runtime owner distinct from raw transport events.
- R2. Permissions, questions, and plan approvals must associate to canonical operations below the UI boundary.
- R3. Transcript, queue, kanban, tab state, and notifications must render projections of resolved operation/interaction state rather than running their own association heuristics.
- R4. Provider-specific IDs or synthetic anchors must not determine whether one logical action renders once or twice.
- R5. Current interaction-store guarantees must remain intact: duplicate question updates preserve reply routing, plan approvals remain canonical interactions, and `exit_plan_mode` stays protected from autonomous auto-approval.
- R6. The migration must stay agent-agnostic: no Copilot-specific UI branches or hardcoded provider checks in presentation layers.
- R7. Compatibility with current streaming/history behavior must be preserved while this layer is introduced incrementally.

## Scope Boundaries

- No redesign of transcript, queue, kanban, or permission/question visuals beyond what is required to consume canonical operation associations.
- No provider protocol redesign in Rust for this phase; desktop may introduce adapter logic and metadata handling, but transport contracts should remain compatible.
- No attempt to unify unrelated runtime concepts such as todos, PR cards, or review flows into the operation layer.
- No forced persistence rewrite for old sessions; historical rendering may continue to adapt existing tool-entry history as long as live ownership becomes canonical.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts` owns tool-call entries and already uses extracted managers plus fine-grained `SvelteMap` reactivity.
- `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts` is the current semantic owner for tool-call lifecycle, child/parent reconciliation, and progressive arguments. It is the clearest existing pattern for extracting operation semantics from raw entry mutations.
- `packages/desktop/src/lib/acp/store/interaction-store.svelte.ts` is now the canonical owner for questions, permissions, answered questions, and plan approvals.
- `packages/desktop/src/lib/acp/store/permission-store.svelte.ts` still resolves permissions to tool rows by direct `callID` match with a semantic execute fallback added in this session.
- `packages/desktop/src/lib/acp/utils/permission-tool-match.ts` proves the current smell: the frontend now has a shared semantic matcher, but it still lives in UI/store-adjacent code instead of a canonical association layer.
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte` and `packages/desktop/src/lib/acp/components/tool-calls/permission-bar.svelte` are the main current consumers of tool/permission association.
- `packages/desktop/src/lib/acp/components/tool-calls/resolve-tool-operation.ts` is an important seam because it already treats a tool call plus pending permission as one rendered concept.
- `packages/desktop/src/lib/acp/store/queue/utils.ts`, `packages/desktop/src/lib/components/main-app-view/components/app-queue-row.svelte`, and `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte` show how queue and kanban still consume raw tool-call snapshots plus separately-derived interactions.
- `packages/desktop/src/lib/acp/store/tab-bar-store.svelte.ts` and `packages/desktop/src/lib/acp/store/urgency-tabs-store.svelte.ts` show another projection surface that would benefit from canonical operation/interaction reads instead of repeated scans.

### Institutional Learnings

- `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md` established the same core rule at another seam: one runtime owner, many projections. Kanban became stable only after panel state became canonical and kanban projected from it.
- `docs/plans/2026-04-07-001-refactor-unified-interaction-model-plan.md` already documented that transport-specific quirks should stay below UI/state layers and that one logical interaction must not have multiple frontend owners.
- `docs/plans/2026-04-07-001-refactor-provider-agnostic-frontend-plan.md` reinforces the repo-wide direction: provider quirks belong in backend/provider-owned contracts and adapters, not presentation.
- `docs/plans/2026-04-07-001-refactor-unify-acp-tool-reconciliation-plan.md` is the closest related architecture: one canonical reconciliation owner, transport-only batching, and thinner frontend semantics.

### External References

- None. Local code and prior Acepe planning artifacts are sufficient for this phase, and the repo already contains strong direct patterns for stores, managers, projections, and canonical-ownership refactors.

## Key Technical Decisions

- **Introduce `OperationStore` as a canonical domain layer:** Tool executions should become first-class operation records with stable IDs, lifecycle state, progressive arguments, and references back to transcript/tool-entry projections.
- **Keep `InteractionStore` canonical for interaction lifecycle:** This plan does not replace `InteractionStore`; it adds a sibling canonical owner for operations and a deterministic association layer between them.
- **Move association logic below UI:** Exact tool ID matching, provider metadata matching, and semantic execute-command fallback must live in one operation-association module, not in render-time helpers or component-specific store queries.
- **Keep provider quirks adapter-owned:** Provider-specific transport artifacts such as synthetic permission anchors stay in ingress metadata and association adapters; projection consumers receive canonical association results only.
- **Make the `ToolCallManager`/`OperationStore` boundary explicit:** `ToolCallManager` remains the mutation/reconciliation adapter that reacts to session-entry updates and child-tool deltas, while `OperationStore` becomes the canonical query/association owner consumed by projection surfaces. This phase should not leave both as peer semantic owners.
- **Preserve existing tool-row rendering during migration:** Transcript can continue to render tool-call-based cards while those cards read operation-backed association state. This minimizes cross-surface churn while changing the ownership layer under them.
- **Introduce indexed lookups instead of repeated scans:** Canonical operation/interaction association should expose O(1)-ish queries by operation ID, tool-call ID, interaction ID, and session-scoped derived views instead of repeated map/entry scans in multiple stores.
- **Prefer explicit identity first, semantic identity second:** Association should always attempt exact explicit references before semantic fallback. Semantic matching is a compatibility strategy, not the canonical primary model.
- **Keep provider metadata extensible but quarantined:** Canonical operations/interactions may carry adapter-owned metadata for association, replay, or restore, but projection consumers must not branch on provider identity or raw transport formats.

## Open Questions

### Resolved During Planning

- **Should this be a new plan or an edit to the interaction-store plan?** New plan. The interaction-store work is a completed architectural phase; this is the next phase focused specifically on operation identity and operation/interation association.
- **Should the fix stay agent-agnostic?** Yes. Provider-specific synthetic IDs are the symptom; the architecture must absorb them without provider-specific UI branches.
- **Should `InteractionStore` be replaced?** No. `InteractionStore` remains the canonical owner for interactions; `OperationStore` becomes the canonical owner for operations and association indexing.
- **Who owns transcript projection in this phase?** Transcript stays backed by `SessionEntryStore` for row rendering in this phase, but all live association and pending-state reads for those rows should come from `OperationStore`/`InteractionStore`.

### Deferred to Implementation

- **Whether the operation layer should own transcript projection directly, or whether transcript should continue reading `SessionEntryStore` with operation-backed associations for one phase:** implementation can settle this based on how invasive the first cut needs to be.
- **Whether some association metadata should be emitted from Rust sooner to reduce semantic fallback on desktop:** can be revisited after the first desktop-side canonical layer lands and remaining fallback cases are visible.
- **Exact boundary between `ToolCallManager` and future `OperationStore`:** implementation should decide whether to wrap, absorb, or split `ToolCallManager` responsibilities once the concrete data flow is clearer.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
provider transport
(session updates / inbound JSON-RPC)
          |
          v
  +----------------------+
  | adapter / normalizer |
  +----------------------+
          |
          +-----------------------------+
          |                             |
          v                             v
  +------------------+         +------------------+
  | OperationStore   |<------->| InteractionStore |
  | canonical tool   |         | canonical waits  |
  | executions       |         | + reply routing  |
  +------------------+         +------------------+
          |
          v
  +----------------------+
  | association queries  |
  | operation <->        |
  | interaction          |
  +----------------------+
          |
   +------+------+------+------+
   |      |      |      |      |
   v      v      v      v      v
 transcript queue kanban tabs notifications
     pure projections of resolved state
```

The key shift is that semantic matching and provider-quirk reconciliation happen once in the canonical layer, not repeatedly in transcript, permission bars, queue items, or kanban cards.

## Alternative Approaches Considered

- **Keep semantic matching in helpers and just share the helper more widely:** rejected because it preserves UI/store-adjacent ownership of a provider-transport problem.
- **Fold operations directly into `InteractionStore`:** rejected because tool executions and user-facing interactions have different lifecycles and query patterns; conflating them would just create a new oversized owner.
- **Wait for Rust to emit perfect association metadata first:** rejected because the frontend already needs a durable canonical layer now, and desktop should not require protocol perfection to stop leaking transport identity into UI.

## Implementation Units

- [ ] **Unit 1: Define the canonical operation domain and indexes**

**Goal:** Introduce a first-class runtime operation model with stable identity, lookup indexes, and compatibility reads for current tool-call projections.

**Requirements:** R1, R3, R7

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src/lib/acp/types/operation.ts`
- Create: `packages/desktop/src/lib/acp/store/operation-store.svelte.ts`
- Create: `packages/desktop/src/lib/acp/store/__tests__/operation-store.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/types/index.ts`
- Modify: `packages/desktop/src/lib/acp/store/index.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts`

**Approach:**
- Define a canonical `Operation` type that captures tool-call identity, resolved kind, lifecycle state, progressive arguments, provider metadata, and source transcript references without making raw `SessionEntry` the only owner.
- Add `OperationStore` with indexed lookups by operation ID, tool-call ID, session ID, and transcript-entry reference.
- Keep compatibility with current tool-call entry flow by letting `ToolCallManager` upsert operations as tool calls are created/updated rather than forcing transcript to switch render models immediately.
- Preserve current child/parent tool hierarchy and streaming argument behavior by treating those as operation state, not component-local reconstruction.
- Lock the migration boundary early: `ToolCallManager` writes/upserts operation state, `OperationStore` answers canonical read/association queries, and no projection surface may bypass that read boundary once migrated.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts`
- `packages/desktop/src/lib/acp/store/services/entry-index-manager.ts`
- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`

**Test scenarios:**
- Happy path — creating a tool call upserts one canonical operation with matching session, tool ID, kind, and lifecycle status.
- Happy path — updating a streaming execute tool updates the same operation record rather than creating a second owner.
- Edge case — child task tool calls preserve parent/child relationships in canonical operation state.
- Edge case — progressive arguments update operation command state without losing previously-known tool metadata.
- Error path — failed or interrupted tool updates preserve one canonical operation identity with correct terminal state.
- Integration — existing transcript entry creation continues to work while operation indexes stay in sync with tool-call mutations.

**Verification:**
- Tool execution state can be queried through one canonical operation layer instead of only by walking raw session entries.
- The `ToolCallManager`/`OperationStore` ownership split is explicitly documented in tests or module-level docs so later units do not recreate dual semantic owners.

- [ ] **Unit 2: Introduce one canonical operation-interaction association layer**

**Goal:** Move permission/question/plan-approval association to operations out of UI helpers and into one shared canonical association module.

**Requirements:** R2, R4, R6, R7

**Dependencies:** Unit 1

**Files:**
- Create: `packages/desktop/src/lib/acp/store/operation-association.ts`
- Create: `packages/desktop/src/lib/acp/store/__tests__/operation-association.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/permission-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/question-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/interaction-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/utils/permission-tool-match.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/permission-store.vitest.ts`

**Approach:**
- Create one association module that resolves `interaction -> operation` using explicit references first, then deterministic semantic fallback where current transports require it.
- Treat semantic execute-command matching as compatibility behavior owned by the canonical association layer, not by permission visibility or tool router helpers.
- Expose operation-aware lookup methods from the permission/question layers so projection consumers no longer guess how to associate a pending interaction with a rendered tool row.
- Keep plan approvals and questions on their canonical interaction lifecycles while attaching them to operations through the same association contract.
- Preserve an adapter-metadata extension point so future provider quirks can enrich association inputs without introducing provider-specific branching into projection consumers.

**Execution note:** Start with failing characterization coverage for the current `shell-permission` style mismatch before moving the matcher down into the canonical layer.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/utils/permission-tool-match.ts`
- `packages/desktop/src/lib/acp/store/permission-store.svelte.ts`
- `packages/desktop/src/lib/acp/types/interaction.ts`

**Test scenarios:**
- Happy path — a permission with an exact `callID` reference resolves to the matching operation with no fallback.
- Happy path — a question or plan approval with explicit tool reference resolves to the correct operation.
- Edge case — an execute permission anchored to a synthetic ID but carrying the same command resolves to the correct execute operation exactly once.
- Edge case — two execute operations with different commands in the same session do not cross-match a semantic fallback permission.
- Error path — malformed or under-specified interaction metadata does not create a false association.
- Integration — permission-store and question-store lookups return the same associated operation result across transcript and session-level projection consumers.

**Verification:**
- No UI component or projection helper needs to implement its own transport-aware permission/question-to-tool matching rules.

- [ ] **Unit 3: Rewire transcript and permission surfaces to consume canonical associations**

**Goal:** Make transcript tool cards and permission bars read association results from the canonical layer instead of component-specific semantic matching.

**Requirements:** R2, R3, R4, R6

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/resolve-tool-operation.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/permission-visibility.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/permission-bar.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-execute.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-edit.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/permission-visibility.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/permission-bar.contract.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/resolve-tool-operation.test.ts`
- Create: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/operation-interaction-parity.contract.test.ts`

**Approach:**
- Replace direct store lookups by raw tool-call ID with operation-aware association queries.
- Make the session permission bar hide or simplify only when the canonical association layer says an interaction is already represented by a tool operation, rather than re-running its own heuristics.
- Keep tool-specific presentational components dumb: they should receive already-associated pending interaction state or already-suppressed command previews, not transport hints.
- Ensure transcript still renders one execute operation card even when the permission anchor ID differs.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
- `packages/desktop/src/lib/acp/components/tool-calls/resolve-tool-operation.ts`
- `packages/desktop/src/lib/acp/components/tool-calls/permission-bar.svelte`

**Test scenarios:**
- Happy path — a pending execute permission attached to an operation renders as one operation concept with inline approval affordance.
- Edge case — a represented execute permission no longer renders a duplicate echoed command preview in the session permission bar.
- Edge case — orphan permissions with no matching operation remain visible and actionable.
- Error path — a failed permission reply leaves the canonical associated operation/interation state actionable without duplicating UI.
- Integration — transcript routing and session permission bar agree on whether a permission is already represented by a tool operation.
- Integration — a single logical execute operation with an attached pending permission yields one command concept across transcript row and session permission bar, with no duplicated command card or preview.

**Verification:**
- Transcript and session permission surfaces derive association state from the same canonical source and no longer diverge on duplicate-vs-represented decisions.
- A parity-focused contract test proves the no-duplicate invariant for transcript plus permission-bar rendering before compatibility helpers are reduced further.

- [ ] **Unit 4: Move queue, kanban, tab, and urgency projections onto operation-backed snapshots**

**Goal:** Stop queue/kanban/tab projections from stitching together raw tool snapshots and interaction maps independently.

**Requirements:** R2, R3, R4, R7

**Dependencies:** Unit 3

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/queue/types.ts`
- Modify: `packages/desktop/src/lib/acp/store/queue/utils.ts`
- Modify: `packages/desktop/src/lib/acp/store/queue/queue-store.svelte.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/app-queue-row.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`
- Modify: `packages/desktop/src/lib/acp/components/queue/queue-item.svelte`
- Modify: `packages/desktop/src/lib/acp/store/tab-bar-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/urgency-tabs-store.svelte.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/live-session-panel-sync.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/tests/live-session-panel-sync.test.ts`

**Approach:**
- Introduce operation-backed per-session snapshots so queue, kanban, tabs, and urgency stores read the same resolved operation + interaction bundle.
- Replace repeated scans over raw tool entries and independent interaction maps with canonical session-scoped projection inputs.
- Preserve current behavior for pending question/permission/plan-approval prioritization while sourcing the associated tool context from operations rather than ad-hoc matching.
- Keep paused/running/idle activity derivation aligned across projections by using one canonical operation/session snapshot path.
- Cut surfaces over in checkpoints rather than free-form drift: transcript/session permission surfaces first, then queue/kanban, then tabs/urgency/live-session materialization. Each checkpoint should have a parity validation pass before the next surface migrates.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/queue/utils.ts`
- `packages/desktop/src/lib/components/main-app-view/components/app-queue-row.svelte`
- `packages/desktop/src/lib/acp/store/tab-bar-store.svelte.ts`
- `packages/desktop/src/lib/acp/store/urgency-tabs-store.svelte.ts`

**Test scenarios:**
- Happy path — one execute operation with an associated permission appears once in queue and once in kanban with no duplicate command-shaped surface.
- Happy path — a session with associated plan approval still projects the correct pending-input priority and associated tool context.
- Edge case — paused sessions preserve paused status in sidebar queue and kanban while still using shared operation-backed association state.
- Edge case — a session with multiple operations does not attach one pending interaction to the wrong operation summary.
- Integration — tab bar, urgency tabs, queue, and kanban all agree on the same pending interaction and associated current operation for one session.
- Integration — after each migration checkpoint, the already-migrated surfaces remain in parity with transcript/session permission surfaces for the same live session.

**Verification:**
- Projection surfaces consume one operation/interation snapshot contract and no longer maintain separate association heuristics.
- The migration can stop after any checkpoint without leaving one already-migrated surface on a different association rule than its paired surface.

- [ ] **Unit 5: Clean up compatibility seams and document the canonical boundary**

**Goal:** Remove or quarantine old helper seams that only existed because association lived above the domain layer, and record the new architectural rule.

**Requirements:** R3, R4, R6, R7

**Dependencies:** Unit 4

**Files:**
- Modify: `packages/desktop/src/lib/acp/utils/permission-tool-match.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/exit-plan-helpers.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/permission-visibility.ts`
- Modify: `packages/desktop/src/lib/acp/store/index.ts`
- Modify: `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md`
- Create: `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`

**Approach:**
- Delete or reduce any helper whose only responsibility was to perform UI-level association guessing once the canonical layer owns that work.
- Quarantine any unavoidable compatibility fallback behind explicit association APIs with narrow scope and clear deletion targets.
- Record the architectural rule that provider transport IDs are adapter data, not frontend domain identity.
- Note how future provider-specific quirks should plug into operation/interaction association without touching presentational code.

**Patterns to follow:**
- `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md`
- `docs/plans/2026-04-07-001-refactor-provider-agnostic-frontend-plan.md`

**Test scenarios:**
- Happy path — public store/query APIs expose enough canonical association information that UI helpers do not need semantic matching internals.
- Edge case — removing compatibility helpers does not regress the `shell-permission` style duplicate execute case.
- Test expectation: none -- the documentation updates themselves are non-behavioral, but any deleted helper seam should keep its behavioral regression coverage in the nearest store/component tests.

**Verification:**
- The codebase has a documented canonical boundary for operation/interaction association, and old UI-level matching helpers are removed or clearly constrained as transitional seams.

## System-Wide Impact

- **Interaction graph:** `SessionEntryStore`, `ToolCallManager`, `InteractionStore`, permission/question stores, transcript tool router, queue/kanban/tab projections, and live-session surfacing all touch this boundary.
- **Error propagation:** Association failures must fail closed (show the interaction as standalone) rather than silently binding it to the wrong operation. Reply failures must continue to preserve pending interaction state.
- **State lifecycle risks:** Partial migration could create temporary double-owners where transcript uses operation-backed association but queue/kanban still scan raw tool entries. Sequencing must keep association reads consistent surface by surface.
- **API surface parity:** Transcript, permission bar, queue item, kanban footer, tab bar, and urgency tabs all need to agree on what the “current operation” and “current interaction” are for a session.
- **Integration coverage:** The core proof is cross-surface parity: the same live session must not show duplicated command concepts in transcript plus permission bar or queue plus kanban.
- **Unchanged invariants:** `InteractionStore` remains the canonical owner for interaction lifecycle; this plan only changes how operations are modeled and how interactions attach to them.
- **Visual / interaction invariants:** This phase must preserve one rendered concept per logical operation, consistent pending affordances across surfaces, existing fallback visibility for orphan interactions, and no regression in paused/running/idle visual state semantics.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `OperationStore` duplicates `ToolCallManager` responsibilities without a clear boundary | Define responsibility split in Unit 1 and use compatibility bridging rather than parallel semantic owners |
| Semantic fallback matching still leaks outward during migration | Centralize fallback in one association layer and forbid new UI-level matching helpers |
| Cross-surface parity regresses during partial rollout | Sequence transcript/session-bar first, then queue/kanban/tab projections, and add parity-focused integration tests |
| Historical sessions become harder to render | Keep transcript/history compatibility via existing entry projections until operation-backed history is worth a dedicated migration |
| Provider-specific metadata requirements emerge mid-implementation | Keep adapter metadata extensible on operations/interactions, but keep providers out of UI contracts |

## Documentation / Operational Notes

- Update `docs/solutions/` after implementation with the architectural lesson so future interaction/operation work does not reintroduce transport-identity leaks into UI.
- This phase has no rollout flag requirement, but it does need regression logs/examples from at least one provider-quirk case and one exact-reference case to prove the canonical boundary is working.
- Treat migration checkpoints as explicit review gates during implementation: do not start queue/kanban cutover until transcript/session-bar parity is green, and do not start tab/urgency/live-session cutover until queue/kanban parity is green.

## Sources & References

- Related plan: `docs/plans/2026-04-07-001-refactor-unified-interaction-model-plan.md`
- Related plan: `docs/plans/2026-04-07-001-refactor-provider-agnostic-frontend-plan.md`
- Related plan: `docs/plans/2026-04-07-001-refactor-unify-acp-tool-reconciliation-plan.md`
- Related learning: `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md`
- Related code: `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/store/interaction-store.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/utils/permission-tool-match.ts`

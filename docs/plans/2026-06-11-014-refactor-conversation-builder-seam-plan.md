---
status: active
type: refactor
created: 2026-06-11
document_reviewed: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture 2026-06-11 run 2, candidate 6)
---

# refactor: Seal the conversation-builder seam behind the Materializer

## Summary

Scene assembly already has a spine — `conversation-dispatcher.ts` selects the cheapest re-materialization path across ~14 patch-builder functions in three `*-patch-conversations.ts` modules. What it lacks is a sealed seam: the patch builders are individually exported with heterogeneous signatures, and `graph-scene-entry-match.ts` (911 LOC) — a read-model coupled to the materializer's patch annotations — lives on the Controller side in `components/agent-panel/logic/`. Normalize the builders behind the dispatcher as the single conversation-builder interface, and move the entry-match index behind the session-state seam it actually depends on.

**Re-baselined from the architecture review:** the review called this "8 modules, no coherent spine." Research shows the dispatcher *is* the spine ("pure orchestration," selecting reuse → activity-only → patch fast paths → full rebuild). The deepening is sealing the seam, not inventing the spine.

**Sequencing:** hard dependency on plan `2026-06-11-005` (typed `ScenePatch` replacing WeakMap tags) — same seam, same files. Land 005 first.

---

## Problem Frame

- `packages/desktop/src/lib/acp/session-state/transcript-patch-conversations.ts` (791 LOC, 7 exports), `interaction-patch-conversations.ts` (728 LOC, 6 exports), `operation-patch-conversations.ts` (251 LOC, 2 exports) — every `materialize*Conversation` function is public, importable, and individually shaped; only `conversation-dispatcher.ts` should ever call them.
- `agent-panel-graph-materializer.ts` (351 LOC) exposes the read model (`createAgentPanelGraphMaterializerReadModel:206`) and already returns a typed scene patch via `selectConversationScenePatch()` — the seam half-exists.
- `components/agent-panel/logic/graph-scene-entry-match.ts` (911 LOC) — `createGraphSceneEntryIndexReadModel:70` reads materializer patch annotations from the Controller's directory. The module is on the wrong side of the seam: its single producer is session-state, its contract is the materializer's patch shape, yet it sits with controller logic and is separately importable.
- The characterization net is one 131K test file (`__tests__/agent-panel-graph-materializer.test.ts`) with 74 cases in essentially one flat describe — a strong net with poor navigability; cases parameterize across patch types because the builders have no common shape.

Deletion test on the individual builder exports: deleting them (making them dispatcher-private) loses nothing — no caller outside the dispatcher should exist. Where one does, that's the leak this plan closes.

---

## Requirements

- R1. The dispatcher's interface is the only public entry for conversation building: `build(graph, previous) → { conversation, scenePatch }` (shape per plan 005's `ScenePatch`). Patch-builder functions are module-private to the session-state seam.
- R2. `graph-scene-entry-match.ts` moves behind the session-state seam (or its index-construction does), consuming the typed `ScenePatch` — no Controller-side module reads materializer patch internals.
- R3. Behavior-preserving: identical entries, patch selections, and fast-path hits for the existing 74-case net.
- R4. Preserved invariants (from learnings): ID-based scene joins (never index-based across merged assistant rows); explicit missing/degraded row path; transcript snapshots as ordering spine only; Acepe-owned display identity — no provider-id grouping state in TS.
- R5. The 74-case net gets navigable structure (concern-grouped describes) without changing any assertion.

---

## Scope Boundaries

**Not changing:**
- Patch-selection strategy or fast-path semantics (which path wins for which input).
- `AgentPanelSceneModel` contract (`packages/agent-panel-contract/`).
- Reveal-text / token-reveal read models (`logic/reveal-text-projection.ts`, `token-reveal-scene-read-model.ts`) beyond import-path changes — their patch *carrier* is plan 005's work.
- The materializer's public read-model interface consumed by `AgentPanelScenePipelineController`.

### Deferred to Follow-Up Work
- Collapsing the three patch-conversation modules into fewer files — only if sealing the seam reveals dead or mergeable builders; not a goal by itself.
- Splitting the 131K test file into multiple files (risk of losing shared fixtures outweighs the gain right now; R5's describe-grouping is the bounded step).

---

## Context & Research

### Relevant Code and Patterns
- `session-state/conversation-dispatcher.ts` — the spine; imports all builders + `conversation-rebuild.ts`, `operation-index.ts`, `transcript-interaction-index.ts`, `scene-entry-row-index.ts`.
- Builder exports: `transcript-patch-conversations.ts:48,143,233,323,535,636,741`; `interaction-patch-conversations.ts:42,150,283,394,498,569`; `operation-patch-conversations.ts:34,146`.
- `agent-panel-graph-materializer.ts:139,206,254` + `selectConversationScenePatch()` (typed patch already returned).
- `logic/graph-scene-entry-match.ts:22,38,70` — the misplaced read model; plan 005 retargets its WeakMap inputs to typed `ScenePatch`.
- Supporting modules staying put: `conversation-cache-types.ts`, `conversation-stability.ts`, `scene-equivalence.ts`, `entry-materializers.ts`, `operation-index-patch.ts`.

### Institutional Learnings
- `docs/solutions/ui-bugs/agent-panel-graph-materialization-rendering-bug-2026-04-28.md` — transcript snapshots are the ordering spine only; match rows by id, not index; the mandated regression: two assistant rows merged into one `assistant_merged` row before a tool row.
- `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md` — no generic `SessionUpdate → ThreadEntry` paths or chunk-aggregation state in TS; provider `message_id`s are grouping hints only. Also the workflow precedent: that effort shipped as eight small numbered plans with grep-scan exit criteria.
- `docs/solutions/test-failures/bun-module-mock-cache-leakage-2026-04-25.md` — module moves change mock-intercepted specifiers; check importers of `graph-scene-entry-match` before relocating.

---

## Key Technical Decisions

- **The dispatcher is the conversation builder.** No new class; the deepening is visibility + signature normalization on what exists. Builders take a normalized input (graph slice, previous cached conversation, indexes) and return the dispatcher's plan shape; the dispatcher remains pure orchestration.
- **Entry-match relocates as a session-state read model.** `createGraphSceneEntryIndex(ReadModel)` moves to `session-state/`; the Controller imports the read model like it imports the materializer's. If plan 005's final shape already localizes the index, this unit becomes a move-only diff — coordinate, don't duplicate.
- **Private-by-export-removal, not by file merge.** Builders stay in their three cohesive files; they stop being exported from the package surface (dispatcher-internal imports only, enforced by a boundary test).
- **Test restructure is assertion-frozen.** Reorganizing 74 cases into concern-grouped describes happens with a diff that touches no `expect`.

---

## Implementation Units

### U1. Verify the net and freeze the seam contract

**Goal:** Confirm the 74-case net covers every fast path and the U-invariants before sealing.
**Requirements:** R3, R4
**Dependencies:** plan 2026-06-11-005 landed
**Files:**
- Test: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts` (audit/extend)

**Approach:** Map the 74 cases to the dispatcher's path list (reuse / activity-only / operation / streaming / transcript / interaction patches / truncation / full rebuild); add pins for any uncovered path. Re-verify the merged-assistant-row regression and missing/degraded row pins exist.
**Execution note:** Characterization-first.
**Test scenarios:**
- One pin per dispatcher fast path asserting both output entries and selected `ScenePatch` kind.
- Merged assistant rows before a tool row → ID-based join still resolves (the mandated regression).
- Degraded/missing operation evidence renders the explicit missing path.

**Verification:** Path-to-test map complete; net green.

### U2. Normalize builder signatures behind the dispatcher and remove their public exports

**Goal:** One conversation-builder interface; builders become implementation.
**Requirements:** R1, R3
**Dependencies:** U1
**Files:**
- Modify: `packages/desktop/src/lib/acp/session-state/{transcript,interaction,operation}-patch-conversations.ts`
- Modify: `packages/desktop/src/lib/acp/session-state/conversation-dispatcher.ts`
- Test: boundary test (extend `packages/desktop/src/lib/acp/session-state/__tests__/` with an import-surface check mirroring the ui-package boundary test pattern)

**Approach:** Align the 14 builders on the dispatcher's normalized input/output; delete external exports (find any non-dispatcher importer first — each is a leak to route through the dispatcher). The materializer read model's public surface is unchanged.
**Test scenarios:**
- Full U1 net green (primary gate — identical outputs per path).
- Boundary test: no module outside `session-state/` imports a `materialize*Conversation` builder.

**Verification:** `rg 'materialize.*Conversation' packages/desktop/src --glob '!**/session-state/**'` returns only dispatcher-mediated usage (read model calls).

### U3. Move the entry-match read model behind the session-state seam

**Goal:** The 911-LOC index lives with its producer.
**Requirements:** R2, R3
**Dependencies:** U2
**Files:**
- Create: `packages/desktop/src/lib/acp/session-state/graph-scene-entry-index.ts` (moved module)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/` importers (`token-reveal-scene-read-model.ts`, scene pipeline controller, viewport consumers)
- Modify/Delete: `packages/desktop/src/lib/acp/components/agent-panel/logic/graph-scene-entry-match.ts`

**Approach:** Relocate with plan 005's typed-`ScenePatch` inputs (coordinate: if 005 already moved or reshaped it, this unit shrinks to residual import hygiene). Controller-side consumers import the read model from session-state. Audit `mock.module` usage against the moved specifier.
**Test scenarios:**
- Existing entry-index tests pass at the new location.
- Fast-path hit rates unchanged: U1's per-path pins still select the same `ScenePatch` kinds.

**Verification:** `components/agent-panel/logic/` contains no module reading materializer patch internals; suite green.

### U4. Restructure the 131K net into concern-grouped describes; clearance

**Goal:** Navigable net; durable seam.
**Requirements:** R5
**Dependencies:** U3
**Files:**
- Modify: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- Modify: `CONTEXT.md` (sharpen the Materializer entry to name the conversation-builder seam)

**Approach:** Group the 74 cases by dispatcher path under named describes; shared fixture builders stay top-level. Zero assertion changes (diff-reviewable guarantee). Update CONTEXT.md.
**Test scenarios:**
- Test expectation: none new — restructure unit; gate is identical test count and zero `expect` changes in the diff.

**Verification:** `bun test` count identical; describes map 1:1 to dispatcher paths; CONTEXT.md updated.

---

## System-Wide Impact

- **Plan 005** — hard predecessor; same files (`graph-scene-entry-match.ts`, materializer, reveal/token-reveal carriers). This plan starts only after 005 lands and re-checks its U3 against 005's final shape.
- **Plan 013 (AgentPanelRootState)** — consumes the scene pipeline controller's unchanged interface; no ordering constraint.
- **`AgentPanelScenePipelineController`** — import paths may change (U3); interface does not.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Overlap/duplication with plan 005's changes | Hard sequencing + U3 explicitly re-scopes against 005's landed shape |
| A hidden non-dispatcher importer of a patch builder | U2 finds importers before deleting exports; each gets routed, not force-broken |
| Test restructure silently drops a case | U4 gate: identical test count, no `expect` diffs |
| Mock specifier breakage from the module move | Importer audit in U3; DI-style stubs preferred |

---

## Sources & References

- Architecture review 2026-06-11 run 2, candidate 6 (re-baselined: dispatcher is the spine)
- Plan `2026-06-11-005-refactor-localize-scene-index-fast-path-plan.md` (hard predecessor)
- `docs/solutions/ui-bugs/agent-panel-graph-materialization-rendering-bug-2026-04-28.md`
- `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`

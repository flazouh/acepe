---
title: refactor: Session lifecycle convergence after proof
type: refactor
status: superseded
date: 2026-04-22
superseded-by: docs/plans/2026-04-25-002-refactor-final-god-architecture-stack-plan.md
---

# refactor: Session lifecycle convergence after proof

> Superseded by `docs/plans/2026-04-25-002-refactor-final-god-architecture-stack-plan.md`. This convergence plan is no longer an active endpoint; the final GOD stack replaces coexistence/convergence framing.

## Overview

This plan covers the **post-proof convergence work** for Acepe's session lifecycle rewrite. It starts only after the proving slice has already established backend lifecycle authority, cc-sdk first-send correctness, canonical restore normalization, and sealed ready-only dispatch.

The goal here is not to re-prove the architecture. The goal is to **converge the rest of the system** onto the proven contract without letting the root bug fix depend on broader provider/frontend cleanup.

## Problem Frame

The proving slice can establish the right authority model on the root failing path without immediately rewriting every provider, optimistic-capability path, and desktop projection surface. But once the proving slice is trusted, leaving the rest of the codebase on legacy assumptions would recreate split-authority pressure:

- some providers would still leak lifecycle meaning through legacy paths,
- optimistic model/mode UX would still pressure the app toward hot-state,
- desktop selectors and components would still infer lifecycle from local booleans,
- docs and regression coverage would lag the actual architecture.

So this follow-on plan exists to finish the convergence **after** proof, not before it.

## Requirements Trace

- R1. Remaining providers must consume the same authority contract proven in the cc-sdk slice.
- R2. Desktop lifecycle UX must derive from canonical lifecycle and actionability fields only.
- R3. Optimistic capability flows must remain canonical and revision-ordered without reintroducing hot-state.
- R4. The architecture must be named and locked in docs/tests so future changes cannot quietly reintroduce split authority.

## Scope Boundaries

- This plan does **not** re-open the proving-slice decisions about `Detached`, restore normalization, or first-send activation.
- This plan does **not** broaden the public command surface beyond the user-intent contract already selected.
- This plan does **not** start unless the proving slice has already passed its stop/go gate.

## Prerequisites

This plan begins only after all of these are true:

1. backend-owned lifecycle authority is proven on cc-sdk,
2. `Reserved` first-send activation and `Detached` restore semantics are canonical end to end,
3. supervisor-originated lifecycle transitions are revision-bearing and replay-safe,
4. ready-only dispatch is sealed behind supervisor checks.

## Key Technical Decisions

- **Do not re-litigate the state machine here.** This plan consumes the already-proven lifecycle contract.
- **Provider convergence stays fact-only.** Adapters may emit transport facts, capability snapshots/deltas, retryability/backoff hints, and identity/provenance details, but never canonical lifecycle conclusions.
- **Frontend convergence stays projection-only.** UI consumes canonical lifecycle, canonical actionability/recovery fields, and canonical capability revisions; it does not reconstruct policy.
- **Optimistic UX must stay canonical.** If a faster UI path cannot be represented by revisioned canonical envelopes, it does not belong in this architecture.

## Implementation Units

- [x] **Unit 1: Canonical capability/actionability convergence**

**Goal:** Complete the post-proof protocol work so optimistic model/mode behavior and lifecycle affordances remain canonical.

**Requirements:** R2, R3

**Dependencies:** proving-slice completion

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/types.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/envelope.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/protocol.rs`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/session-store-create-session.vitest.ts`
- Create: `packages/desktop/src/lib/acp/store/__tests__/session-store-capabilities-revision.vitest.ts`

**Approach:**
- Extend capability envelopes with `revision` and optional `pendingMutationId`.
- Keep lifecycle/actionability fields canonical and structured: no string-matching heuristics for retry, resume, or send CTA behavior.
- Ensure optimistic model/mode updates resolve through canonical revisions rather than hot-state rollback logic.
- Define canonical preview states for pending, failed, partial, and stale capability data so pre-activation selectors never invent their own loading/error semantics.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`

**Test scenarios:**
- Happy path — optimistic model change emits `pendingMutationId`, then a higher confirmed `revision` supersedes it.
- Error path — rejected model/mode change emits a corrective higher revision and removes optimistic state.
- Edge case — stale capability envelopes with lower revision are ignored.
- Edge case — preview capabilities pending/failed/partial states produce deterministic canonical selector behavior before activation.
- Integration — lifecycle/actionability selectors remain canonical while optimistic capability updates occur.

**Verification:**
- Canonical envelopes alone express optimistic and corrective capability behavior.

- [ ] **Unit 2: Remaining provider convergence**

**Goal:** Move ACP subprocess, Codex native, and OpenCode onto the proven transport boundary and remove the compatibility bridge.

**Requirements:** R1, R4

**Dependencies:** proving-slice completion, Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/provider.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/session_lifecycle.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs`
- Modify: `packages/desktop/src-tauri/src/acp/opencode/http_client/agent_client_impl.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client_trait.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/tests.rs`
- Test: `packages/desktop/src-tauri/src/acp/client/tests.rs`

**Approach:**
- Migrate remaining adapters to the transport boundary using typed retryability, freshness, provenance, and identity facts.
- Remove `TransportAdapterCompat` once every provider routes through the new boundary.
- Preserve provider-owned policy hints without letting them become lifecycle truth.
- Keep provider-owned presentation policy on the provider boundary so shared clients do not reconstruct model-selector behavior from parser agent identity.

**Patterns to follow:**
- `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`

**Test scenarios:**
- Happy path — each remaining provider satisfies the generic transport contract with no lifecycle publication.
- Edge case — provider-specific resume/load semantics are expressed through typed policy, not shared lifecycle branching.
- Edge case — provider-specific model presentation is expressed through typed provider contract, not shared parser-agent branching.
- Integration — removing the compatibility bridge does not change already-proven cc-sdk behavior.

**Verification:**
- All providers enter the supervisor through one transport abstraction.

- [ ] **Unit 3: Desktop canonical-only projection**

**Goal:** Remove `SessionHotState` and make the desktop a pure consumer of canonical lifecycle, actionability, and capabilities.

**Requirements:** R2, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/types.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-state.ts`
- Modify: `packages/desktop/src/lib/acp/store/composer-machine-service.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-event-handler.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/hot-state-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/session-state-reader.ts`
- Modify: `packages/desktop/src/lib/acp/store/live-session-work.ts`
- Modify: `packages/desktop/src/lib/acp/store/queue/utils.ts`
- Modify: `packages/desktop/src/lib/acp/application/dto/session.ts`
- Modify: `packages/desktop/src/lib/acp/store/tab-bar-utils.ts`
- Modify: `packages/desktop/src/lib/acp/store/tab-bar-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/urgency-tabs-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/workspace-store.svelte.ts`
- Modify: `packages/desktop/src/lib/components/settings/project-tab/columns/status-cell.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tab-bar/tab-bar-tab.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- Delete or absorb: `packages/desktop/src/lib/acp/store/session-hot-state-store.svelte.ts`
- Create: `packages/desktop/src/lib/acp/store/__tests__/session-store-lifecycle-projection.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/hot-state.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/session-hot-state-store.vitest.ts`

**Approach:**
- Replace every `hotState.isConnected` / `hotState.status` read with canonical selectors.
- Make `Reserved`, `Activating`, `Reconnecting`, `Detached`, `Failed`, and `Archived` explicit UI states.
- Keep CTA logic driven by canonical actionability/recovery fields, not by status/reason combinations inferred locally.
- Define primary vs secondary recovery surfaces so resume/retry/archive affordances do not fragment across panel, tabs, and status cells.
- Define compact-surface behavior for lifecycle copy and actions so tab/status surfaces degrade predictably without hiding critical recovery meaning.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`

**Test scenarios:**
- Happy path — canonical `Ready` enables send and marks the session live.
- Edge case — `Detached` shows resumable/offline UI from canonical actionability fields with no `isConnected` fallback.
- Edge case — `Reconnecting` shows bounded auto-recovery plus the canonical stop-waiting/manual-recovery path.
- Error path — `Failed` exposes only canonical error-handling actions.
- Integration — store-facing interfaces compile with no `SessionHotState` types anywhere in the path.
- Integration — panel owns primary recovery actions while tab/status surfaces mirror non-primary status compactly and consistently.
- Accessibility — lifecycle regressions announce deterministically through live regions and preserve focus behavior.

**Verification:**
- No desktop flow depends on hot-state for lifecycle truth or CTA behavior.

- [ ] **Unit 4: Documentation and invariant lock-in**

**Goal:** Name the architecture clearly in docs/tests so the convergence result is durable.

**Requirements:** R4

**Dependencies:** Units 1-3

**Files:**
- Modify: `docs/concepts/session-graph.md`
- Modify: `docs/concepts/reconnect-and-resume.md`
- Create: `docs/solutions/architectural/session-lifecycle-convergence-after-proof-2026-04-22.md`
- Modify: `packages/desktop/src-tauri/src/acp/lifecycle/supervisor_tests.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client/tests.rs`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/session-store-lifecycle-projection.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`

**Approach:**
- Name the architectural invariants directly in tests.
- Update concept docs to describe the post-proof authority chain and the canonical frontend/provider contracts.
- Record removal of `SessionHotState` and compatibility bridge as deliberate architecture choices, not cleanup folklore.

**Patterns to follow:**
- `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md`

**Test scenarios:**
- Full lifecycle journey — reserve -> activate -> ready -> reconnect -> detached -> resume -> ready -> archive remains consistent across backend and desktop layers.
- Contract — provider adapters emit transport facts only.
- Integration — lifecycle waiter and revision frontier remain replay-safe after full convergence.

**Verification:**
- The post-proof architecture is documented, named, and regressible.

## Success Metrics

1. `SessionHotState` is gone from desktop lifecycle truth and CTA logic.
2. All providers route through the same transport boundary without lifecycle publication.
3. Canonical lifecycle/actionability fields are sufficient for all desktop surfaces.
4. Optimistic capability UX remains canonical and revision-ordered.
5. Docs and invariant-named tests describe the same architecture the code implements.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Convergence work starts before proof is trusted | Treat proving-slice completion as a hard prerequisite, not a soft suggestion |
| Provider convergence reintroduces lifecycle leakage through capability or retry signals | Keep adapter facts typed and provenance-bearing, never canonical |
| Desktop convergence recreates heuristics through action mapping | Require canonical actionability/recovery fields and remove hot-state consumers repo-wide |

## Sources & References

- Related docs: `docs/concepts/session-graph.md`
- Related docs: `docs/concepts/reconnect-and-resume.md`
- Related docs: `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md`
- Related docs: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- Related docs: `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`

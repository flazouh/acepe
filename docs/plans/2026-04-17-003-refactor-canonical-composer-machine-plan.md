---
title: refactor: canonical composer machine
type: refactor
status: active
date: 2026-04-17
---

# refactor: canonical composer machine

## Overview

Replace the composer's hidden component-local submit/config/dispatch gating with one canonical XState-driven composer state layer that makes visible UI affordances and actual submit behavior agree for historical reopen, queueing, steering, and config transitions.

## Problem Frame

The reopened-session send failure exposed a split-brain architecture in the composer. `SessionRuntimeState` correctly says a loaded historical session is sendable even while disconnected, because `SessionStore.sendMessage()` already knows how to lazy-connect on first submit. But `agent-input-ui.svelte` still owns a separate async veto path through `pendingSessionConfigOperation`, provisional toolbar state, `provisionalAutonomousEnabled`, and local `isSending` orchestration.

That lets the UI render an enabled send action while the real submit path silently exits before dispatch. The same architectural drift also makes queue behavior and config transitions harder to reason about because some policy lives in store/runtime state and some lives in the component.

The clean fix is not another local guard. The composer needs one canonical state owner that:

- scopes pending config work to the current session/panel,
- projects a single submit policy to the UI,
- preserves existing queue semantics,
- and leaves provider/runtime policy at the existing store/backend seams instead of re-deriving it inside the Svelte component.

## Requirements Trace

- R1. A reopened loaded historical session must never display an enabled send affordance while a hidden local gate can still veto submit.
- R2. Visible composer state and actual submit behavior must derive from one canonical state source.
- R2a. All submit-affecting input surfaces — primary button, queue, steer, Enter key, and voice — must read from the same derived machine state.
- R3. Queue behavior must remain first-class: busy sessions still enqueue, drain on turn completion, and do not regress existing queue limits or pause behavior.
- R4. Session-scoped config transitions (mode/model/config option changes) must not leak across session or panel rebinding.
- R5. The composer controller stays in `packages/desktop`; `@acepe/ui` remains presentational only.
- R6. Existing lazy-connect-on-first-submit behavior for loaded/disconnected historical sessions remains intact.
- R7. Legacy component-local hidden submit/config state is removed once the canonical machine is in place.

## User-Visible Success Criteria

- Reopening a historical session shows the correct send affordance immediately and submitting from that session dispatches reliably.
- While a mode/model/config change is in flight, the composer visibly reflects that submit is blocked instead of silently no-oping.
- The existing disabled button and selector affordances are sufficient for the blocked-config state; this refactor does not add a new visual treatment in `@acepe/ui`.
- Busy sessions still show queue behavior exactly as they do today, including drain-after-turn-complete.
- Session or panel rebinding does not resurrect stale pending config work from the prior session.
- A failed config transition reverts the relevant provisional selector state to the last committed value, re-enables composer actions, and does not leave the UI in a stuck blocked state.

## Scope Boundaries

- In scope is replacing hidden composer submit/config policy with a canonical machine/service/store.
- In scope is wiring the existing queue/runtime signals into that canonical policy layer.
- In scope is removing component-local pending config gating once the new path is authoritative.
- In scope is regression coverage for the reopened historical-session send bug.
- Not in scope is redesigning the visual composer UX.
- Not in scope is changing `messageQueueStore` semantics or moving it into the new machine.
- Not in scope is changing the session machine's lifecycle contract beyond consuming its existing runtime signals.
- Not in scope is moving composer runtime logic into `@acepe/ui`.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` currently owns `pendingSessionConfigOperation`, provisional toolbar state, `handleSend()`, and queue/send branching.
- `packages/desktop/src/lib/acp/components/agent-input/logic/submit-intent.ts` already centralizes some pure submit-policy decisions and now contains red-test inputs for a blocking config gate.
- `packages/desktop/src/lib/acp/logic/session-machine.ts` is the existing XState v5 pattern for canonical session lifecycle.
- `packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts` shows the expected actor-hosting pattern with `SvelteMap` snapshot caches for reactive reads.
- `packages/desktop/src/lib/acp/logic/session-ui-state.ts` intentionally allows submit for `DISCONNECTED + LOADED`, which is correct for historical lazy-connect and should remain authoritative.
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts` already delegates lazy connection on send through `SessionMessagingService`, so the new machine should consume that capability rather than duplicate it.
- `packages/desktop/src/lib/acp/store/message-queue/message-queue-store.svelte.ts` is the canonical queue owner and should remain so; the composer machine decides between send vs enqueue but does not replace queue storage/draining.
- `docs/plans/2026-04-11-001-refactor-extract-agent-composer-components-plan.md` established the controller/view split: composer runtime logic stays in desktop, presentational surfaces stay in `@acepe/ui`.

### Institutional Learnings

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` — policy and identity must come from canonical contracts, not UI projections or local heuristics.
- `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md` — restore/rebind bugs should be fixed at the earliest identity boundary rather than repaired later.
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` — one lifecycle concern should have one canonical owner.
- `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md` — capture reactive identity before async boundaries and keep async work out of presentation state.

### External References

- None. The codebase already has the relevant XState, store, and queue patterns.

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| Introduce a dedicated composer machine instead of extending `session-machine.ts`. | Session lifecycle and composer policy are related but distinct concerns; coupling them would make both machines harder to reason about. |
| Keep `messageQueueStore` as the queue owner and treat queue status as an input/output of composer policy. | Queueing is already implemented and tested; the bug is policy drift, not queue storage. |
| Model config work explicitly as machine state instead of a component `Promise<boolean>`. | The current bug exists because hidden async state can veto submit without changing visible UI state. |
| Model submit dispatch as machine state and replace component-local `isSending`. | Send-in-flight is also part of the current split-brain and must become canonical so button, keyboard, and voice gating agree. |
| Scope the machine by stable local session identity and reset/rebind on panel/session changes. | Historical reopen and panel reuse are exactly where stale local state currently leaks. |
| Preserve `SessionRuntimeState.canSubmit` for `DISCONNECTED + LOADED` and layer composer blocking on top of it. | Historical lazy-connect is intentional and already works through `SessionStore.sendMessage()`. |
| Blocking config state overrides send, queue, and Enter-submit. | A stale config blocker must not silently survive through an alternate submit path; config blocking wins over queueing until the config phase settles. |
| `steer` remains a first-class composer output. | The refactor should unify all submit-affecting affordances, not just the primary send button. |
| Mode, model, and other submit-relevant selectors are disabled while config work is blocking. | Preventing stacked config transitions is simpler and safer than preserving hidden chaining behavior through rebinds. |
| During a blocking config phase, the primary send button, queue button, and steer affordances are all disabled using existing disabled styling; Enter-submit and voice-submit are suppressed by the controller. | This makes the blocked-config UX explicit without adding a new `@acepe/ui` treatment. |
| Failed config transitions revert provisional state to the last committed session state and return the machine to an interactive idle snapshot. | This preserves the current UI shape, avoids a new persistent error mode, and gives the user a deterministic recovery path. |
| Host the composer machine in a dedicated desktop service exposed through `SessionStore`, not in a standalone Svelte context wrapper. | This matches the existing `SessionConnectionService` pattern and keeps `SessionStore` as the canonical controller-facing access point without leaking actor internals. |
| Rebinding uses an explicit `SESSION_BOUND` reset event that clears ephemeral blocking/dispatch state and re-seeds committed config from store/runtime state. | R4 depends on a concrete reset mechanism; rebinding must not re-surface ghost pending work from prior panel attachment. |
| `SESSION_BOUND` re-seeds synchronously from already-available store snapshots. | Rebind must not depend on async reads or reactive lag, or rapid panel switching can recreate ghost-state drift. |
| Config mutations run through actor-owned async effects that are invalidated on `SESSION_BOUND`. | Replacing `pendingSessionConfigOperation` with machine state only works if stale completions cannot re-enter the freshly bound actor. |
| The bound-session composer machine owns autonomous toggle state after cutover. | `provisionalAutonomousEnabled` is currently another split-brain seam and must stop flowing from `panelStore` for active sessions. |
| Keep provider/runtime policy at existing store/backend seams; the machine consumes typed state and emits intents. | This follows the repo rule against deriving policy from UI projections or labels. |
| Delete legacy component-local gating after cutover instead of leaving a fallback path. | Keeping both paths would preserve the split-brain bug class. |

## Open Questions

### Resolved During Planning

- **Should queueing move into the new machine?** No. The machine decides whether the current intent is send vs queue, but `messageQueueStore` remains the queue owner and drain mechanism.
- **Should the new machine replace the session machine?** No. It composes with `SessionRuntimeState` rather than absorbing connection/content lifecycle.
- **Should loaded/disconnected historical sessions remain sendable?** Yes. The existing lazy-connect-on-send behavior is correct and should be preserved.
- **Should provisional mode/model state remain local Svelte state?** No. The canonical machine should own any submit-relevant provisional/config state.
- **Should `isSending` remain local?** No. Send-dispatch state moves into the machine so primary-button state, Enter behavior, and voice gating share one canonical source.
- **When config blocking is active on a busy session, should queue still be available?** No. Config blocking wins over queue and steer until the config phase settles.
- **Does blocked-config state require a new visual treatment?** No. The existing disabled affordances are sufficient for this refactor.
- **Should `steer` be modeled explicitly?** Yes. It remains a first-class machine-derived output.
- **Should selectors stay interactive while config work is blocking?** No. Mode/model/config selectors are disabled until the blocking config phase settles.
- **What happens when a config transition fails?** The machine restores the last committed selector values, clears blocking state, and returns to an interactive idle snapshot without introducing a new persistent UI mode.
- **Where should the actor host live?** In a dedicated composer-machine service exposed through `SessionStore`.
- **How does rebinding clear stale state?** The controller/service sends `SESSION_BOUND` to the actor, which resets ephemeral blocking/dispatch state and re-seeds committed config from store/runtime state for that session.
- **What fields are re-seeded on `SESSION_BOUND`?** `committedModeId`, `committedModelId`, and `committedAutonomousEnabled`, all sourced from canonical session hot/runtime state; panel-scoped provisional values are discarded for bound sessions.
- **How are stale async config completions prevented after rebind?** Config mutations run through actor-scoped async effects; leaving the blocking-config state via `SESSION_BOUND` invalidates the in-flight effect so its completion cannot mutate the rebound actor.
- **Does this refactor change pre-session panel autonomy ownership?** No. The cleanup target is the bound-session split-brain; pre-session panel state may stay panel-owned until session creation, but `agent-input-ui.svelte` must stop reading `panelStore.provisionalAutonomousEnabled` once a real `sessionId` is bound.

### Deferred to Implementation

- **Exact event taxonomy and whether config transitions are one region or multiple nested substates** — the plan now fixes the required semantics (`SESSION_BOUND`, blocking-overrides-submit, dispatch-phase ownership, stale-effect invalidation), while final machine factoring can follow implementation ergonomics.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
session machine/runtime state --------\
                                       \
message queue state ---------------------> composer machine -----> composer UI props
                                         /        |                     (button intent,
provider/config capability inputs ------/         |                      disabled state,
                                                  |                      visible blocking,
                                                  |                      selector disabled state)
                                                  v
                                     desktop controller actions
                               (send now, enqueue, steer, change mode/model/config,
                                session-bound reset)

Key invariant:
- the same machine snapshot that decides "show enabled send" also decides whether
  submit may proceed past the controller gate.
```

## Implementation Units

- [ ] **Unit 1: Define the canonical composer machine and derived UI contract**

**Goal:** Introduce a dedicated XState machine and pure UI-state derivation for composer submit/config/dispatch policy.

**Requirements:** R1, R2, R2a, R3, R4, R6

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src/lib/acp/logic/composer-machine.ts`
- Create: `packages/desktop/src/lib/acp/logic/composer-ui-state.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-input/logic/submit-intent.ts`
- Test: `packages/desktop/src/lib/acp/logic/__tests__/composer-machine.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-input/logic/submit-intent.test.ts`

**Approach:**
- Define machine context around stable local session identity, current submit/config phase, dispatch phase, and any submit-relevant provisional config state (including the current autonomous toggle value when it seeds send bootstrap).
- Encode explicit blocking states for config work instead of using a promise that resolves to `false`.
- Derive one canonical composer UI contract from the machine snapshot, including whether submit is blocked, whether queue or steer is the default action, whether selectors are disabled, and whether the primary button should be disabled.
- Wire the existing `hasBlockingPendingSessionConfigOperation` inputs in `submit-intent.ts` to the new derived state so the red tests become meaningful policy assertions.
- Make the pure helper changes explicit: `resolveDefaultSubmitAction()` returns `"none"` when `hasBlockingPendingSessionConfigOperation` is true, `isPrimaryButtonDisabled()` returns `true` when it is true, and `resolveEnterKeyIntent()` gains the same boolean input and returns `"none"` when blocking is active.
- Make blocking-config semantics explicit in `submit-intent.ts`: blocking config suppresses send, queue, steer, and Enter-submit until the config phase settles.
- Extend `resolveEnterKeyIntent` to consume the same machine-derived blocking signal so Enter-submit cannot bypass the primary-button policy.
- Replace component-local `isSending` semantics with a machine-owned dispatch phase that other controller logic, including voice gating, can consume.
- Define the minimum `ComposerUiState` contract in this unit: `isBlocked`, `isDispatching`, `defaultAction`, `primaryActionDisabled`, `selectorsDisabled`, `committedModeId`, `committedModelId`, and `committedAutonomousEnabled`.
- Keep the machine focused on policy, not on executing Tauri/store side effects inline.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/logic/session-machine.ts`
- `packages/desktop/src/lib/acp/logic/session-ui-state.ts`

**Test scenarios:**
- Happy path: idle config state with loaded/disconnected runtime produces an allowed send action.
- Happy path: busy runtime produces queue as the default action without disabling the queue affordance.
- Happy path: steer remains available as a first-class machine-derived action when the existing controller conditions call for it.
- Edge case: a blocking config transition suppresses default send, queue, and steer defaults, blocks Enter-submit, disables selectors, and marks the primary action disabled until the config phase settles.
- Edge case: a blocking config transition disables the voice-submit affordance through the same dispatch/blocking state used by the primary composer controls.
- Edge case: rebinding to a different session resets stale blocking state.
- Error path: failed config transition restores the last committed selector state, clears blocking, and returns to an interactive idle snapshot rather than leaving a silent allow/no-op mismatch.
- Integration: `submit-intent.ts` returns `"none"`, disables the primary button, suppresses Enter-submit, and suppresses steer/queue defaults when the machine-derived blocking flag is true.

**Verification:**
- A pure machine snapshot is sufficient to explain every visible send/queue/blocked state without referencing component-local promises.

- [ ] **Unit 2: Add a composer machine host service and session-store integration**

**Goal:** Host per-session composer actors with reactive snapshot caching and expose them through the desktop store layer.

**Requirements:** R2, R4, R5, R6

**Dependencies:** Unit 1

**Files:**
- Create: `packages/desktop/src/lib/acp/store/composer-machine-service.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/types.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/composer-machine-service.test.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-store-composer-state.vitest.ts`

**Approach:**
- Mirror the existing `SessionConnectionService` actor-hosting pattern: one actor per session, `SvelteMap` snapshot cache, typed send helpers, cleanup on session removal.
- Expose a store-facing getter for derived composer state so controllers can consume it through the same reactive path as `SessionRuntimeState`.
- Thread any required stable identity or restore metadata through this layer so panel/session rebinding cannot retain stale config work.
- Add explicit store-facing composer state exports in `store/types.ts` so `SessionStore` exposes a concrete contract instead of leaking raw actor internals. The minimum store-facing shape is `canSubmit`, `isBlocked`, `isDispatching`, `defaultAction`, `selectorsDisabled`, `committedModeId`, `committedModelId`, and `committedAutonomousEnabled`.
- Handle panel/session attachment through an explicit `SESSION_BOUND` event that clears ephemeral blocking/dispatch state and re-seeds committed config from store/runtime state for the bound session.
- Keep `SESSION_BOUND` reseeding synchronous by reading from already-available session hot/runtime snapshot state rather than an async fetch.
- Model config mutations as actor-owned async effects that are invalidated when `SESSION_BOUND` exits the blocking-config state, so stale completions cannot re-enter the rebound actor.
- Keep the new service desktop-owned and do not expose it to `@acepe/ui`.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts`
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`

**Test scenarios:**
- Happy path: creating/getting a composer actor yields a reactive snapshot for a session id.
- Edge case: removing a session cleans up the actor and snapshot cache.
- Edge case: opening a different session under the same panel does not preserve the prior session's blocking config state.
- Edge case: navigating away from session A and back to session A does not resurrect ghost blocked state; `SESSION_BOUND` reseeds the actor from current committed store/runtime state.
- Edge case: rapidly switching A -> B -> A reseeds from synchronous snapshot state and does not apply stale config completions from the abandoned bind.
- Error path: a failed config completion event is reflected through the derived store-facing composer state.
- Integration: `SessionStore` can surface both runtime state and composer state for the same historical session without re-deriving policy in the component.

**Verification:**
- The desktop has one canonical reactive read path for composer policy, parallel to the existing session machine path.

- [ ] **Unit 3: Cut `agent-input-ui.svelte` over to the canonical composer state**

**Goal:** Remove hidden component-local submit/config policy and make the desktop controller consume the new machine state for send, queue, and config transitions.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 1-2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-input/logic/submit-intent.ts`
- Create: `packages/desktop/src/lib/acp/components/agent-input/logic/__tests__/historical-session-send.test.ts`

**Approach:**
- Replace `pendingSessionConfigOperation`, provisional config gating, and related silent early returns with machine-driven intents and state reads.
- Keep `handleSend()` as the controller entry point, but have it consult the canonical composer state before deciding send vs queue vs steer vs block.
- Route mode/model/config changes through explicit machine events so the visible button state changes immediately when config work starts and selectors are disabled until the blocking phase settles.
- Preserve the existing queue path and lazy-connect send path; the main change is who decides whether send is currently legal.
- Replace component-local `isSending` reads with machine dispatch-phase reads so button state, Enter-submit, and voice interaction gating all consume the same controller-owned state.
- Stop reading `panelStore.provisionalAutonomousEnabled` for bound sessions; the bound-session autonomous toggle comes from composer machine state seeded from canonical session hot/runtime data.
- On config failure, restore the last committed selector state from canonical store/runtime data rather than leaving provisional selections stranded.
- Remove the legacy fallback once the machine path is authoritative so there is no second hidden veto path left in the component. Completion requires deleting `pendingSessionConfigOperation`, component-local `isSending`, and bound-session reads of `panelStore.provisionalAutonomousEnabled` from `agent-input-ui.svelte`.

**Execution note:** Start with the existing red policy tests, then add controller-level coverage before deleting the legacy gating path.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- `packages/desktop/src/lib/acp/logic/session-ui-state.ts`

**Test scenarios:**
- Happy path: a loaded/disconnected historical session with draft input invokes send and reaches the store send path.
- Happy path: an actively running session with draft input defaults to queue and still enqueues successfully.
- Edge case: a config change started immediately before submit visibly blocks send and does not allow a silent no-op click path.
- Edge case: switching sessions clears stale blocked state and restores the correct send affordance for the new session.
- Error path: a failed config transition reverts selectors to the last committed values and re-enables interaction instead of leaving the UI apparently sendable but inert.
- Integration: Enter key behavior, primary button behavior, steer behavior, and voice gating all follow the same machine-derived policy.
- Integration: the controller passes canonical composer state down as props to `@acepe/ui` presentational components; no `@acepe/ui` component reads desktop store or machine state directly.

**Verification:**
- `agent-input-ui.svelte` no longer contains a component-local async submit veto that can diverge from visible button state.

- [ ] **Unit 4: Add regression coverage for historical reopen, rebinding, and queue interplay**

**Goal:** Lock in the behavioral guarantees that motivated the refactor so the bug class cannot reappear through future UI-only changes.

**Requirements:** R1, R2, R3, R4, R6, R7

**Dependencies:** Units 1-3

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-input/logic/submit-intent.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/composer-machine-service.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/session-store-composer-state.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-input/logic/__tests__/historical-session-send.test.ts`

**Approach:**
- Preserve the focused red policy tests as the smallest proof that blocked config state suppresses visible send.
- Add integration coverage around reopened historical sessions so loaded/disconnected + blocked/unblocked composer state is exercised through the real store/controller seam.
- Add a rebinding-focused regression so actor cleanup and session/panel identity changes are covered explicitly.
- Cover queue interplay only where it crosses the new policy boundary; do not duplicate existing queue internals unnecessarily.
- Keep rebinding and `SESSION_BOUND` coverage in store/composer tests rather than app-initialization tests, so startup concerns and composer-policy concerns stay separated.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/session-store-composer-state.vitest.ts`

**Test scenarios:**
- Happy path: reopening a historical session with no blocking config state allows first-submit lazy connection and send.
- Edge case: reopening after a prior blocked config transition does not inherit stale blocked state.
- Edge case: a busy session still queues rather than blocking on unrelated config-state policy.
- Edge case: when the composer is in dispatch phase, voice-submit is disabled through the same machine-derived state used by button and keyboard paths.
- Error path: rebinding while a config mutation is in flight invalidates the stale async effect and does not reapply its completion to the rebound session actor.
- Integration: initialization/rebind flows leave the composer machine aligned with the reopened session identity and loaded runtime state.

**Verification:**
- The reopened-session send regression is covered above the pure helper level, and queue semantics stay unchanged.

## System-Wide Impact

- **Interaction graph:** `agent-input-ui.svelte` will stop owning hidden config/submit lifecycle and instead consume `SessionStore` + composer-machine service state alongside `messageQueueStore`.
- **Error propagation:** config-operation failures should revert provisional state, clear blocking, and surface through the controller's existing error path instead of a resolved `false` promise that disappears.
- **State lifecycle risks:** actor cleanup on session removal and rebinding is critical; stale actors would recreate the same class of ghost-blocker bug.
- **API surface parity:** button click, Enter submit, steer, and voice gating must all consume the same derived composer policy.
- **Integration coverage:** reopen, rebind, queue drain, and config transitions cross component/store/machine boundaries and need tests above pure helpers.
- **Unchanged invariants:** `SessionRuntimeState.canSubmit` for loaded/disconnected sessions, `messageQueueStore` ownership, existing disabled affordances, and `@acepe/ui`'s presentational-only boundary remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Composer machine duplicates queue or runtime logic instead of consuming canonical inputs. | Keep queue ownership in `messageQueueStore` and runtime ownership in `SessionRuntimeState`; the machine only owns composer policy. |
| Rebinding/session cleanup misses an actor teardown path and reintroduces stale blocked state. | Centralize actor lifecycle in the host service and add explicit cleanup/rebind tests. |
| Refactor preserves old local guards as a fallback, leaving two sources of truth. | Treat deletion of `pendingSessionConfigOperation` gating as a required completion condition. |
| UI-only tests miss a store/controller regression in historical reopen. | Add one integration-style reopened-session test above the pure helper layer. |

## Documentation / Operational Notes

- If implementation reveals a generally reusable pattern for desktop-owned UI policy actors, document it in `docs/solutions/` after the code lands.
- No rollout flag is needed; this is an internal architectural correction with regression coverage.

## Sources & References

- Related code: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- Related code: `packages/desktop/src/lib/acp/logic/session-machine.ts`
- Related code: `packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/store/message-queue/message-queue-store.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/logic/session-ui-state.ts`
- Related plan: `docs/plans/2026-04-11-001-refactor-extract-agent-composer-components-plan.md`
- Related solution: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`

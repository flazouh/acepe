---
title: refactor: unify session work status projection
type: refactor
status: active
date: 2026-04-12
deepened: 2026-04-12
origin: docs/brainstorms/2026-03-31-kanban-view-requirements.md
---

# refactor: unify session work status projection

## Overview

Replace the current multi-step status reconstruction for kanban, queue, tab/session summaries, and compact session-status consumers with one store-layer session work projection plus shared selectors. The XState session machine remains the lifecycle source of truth, but UI surfaces stop re-deriving working status independently from `SessionStatus`, `SessionRuntimeState`, local helpers, and ad hoc unseen-state reads.

## Problem Frame

Acepe already established that kanban, queue, and panel layouts must be different presentations of the same live thread state (see origin: `docs/brainstorms/2026-03-31-kanban-view-requirements.md`). The current implementation still violates that intent at the status-classification seam: kanban columns, queue sections, session-row badges, tab/session summaries, and compact activity/status indicators rebuild session meaning through different intermediate models.

That drift is now architectural, not cosmetic:

- `packages/desktop/src/lib/acp/logic/session-machine.ts` and `packages/desktop/src/lib/acp/logic/session-ui-state.ts` define lifecycle truth, but kanban rebuilds a simpler `SessionStatus` in `kanban-view.svelte`.
- `packages/desktop/src/lib/acp/store/queue/utils.ts` and `packages/desktop/src/lib/acp/store/tab-bar-utils.ts` each derive `SessionState` separately.
- `packages/desktop/src/lib/acp/store/thread-board/build-thread-board.ts` and `packages/desktop/src/lib/acp/store/queue/queue-section-utils.ts` implement similar but not identical classification rules.
- `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte` mutates unseen/seen state during render, so column membership changes as a side effect of display.
- `packages/desktop/src/lib/acp/store/types.ts` advertises `hotState.sessionState` as if it were canonical, but no runtime write path maintains it.

The result is a split-brain board model: it mostly works, but status semantics can drift again whenever a new surface adds its own projection shortcut. The clean architecture is to compute one canonical session work projection in the store layer and make every surface consume it.

## Requirements Trace

- R1. Preserve the existing panel-backed thread model so kanban, queue, and normal layouts stay projections of one live session runtime (origin R4, R5, R33, R34, R36, R37).
- R2. Keep board column semantics stable and explicit: Answer Needed, Planning, Working, `needs_review` (legacy/origin `finished`), Idle, and Error must remain runtime-derived rather than user-assigned (origin R10, R15, R17, R18, R19, R20).
- R3. Eliminate duplicate classification logic so plan-mode activity, unseen completion, paused work, and error states cannot drift between queue and kanban.
- R4. Remove render-time mutations from status determination; “seen” must change only through explicit user interaction, not because a component iterated a section.
- R5. Keep UI-specific presentation concerns in UI consumers and status semantics in store/runtime projections, consistent with the provider-owned-policy guidance in `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`.
- R6. Make the post-completion and paused-state semantics explicit across surfaces: the canonical model expresses **completion + acknowledgement** separately, shared selectors derive `needs_review` as a semantic review state, compact UI copy uses “Ready for review”, and paused work stays in the active-work family but may render paused-specific icon/text in consumers.
- R7. Define one acknowledgement rule for unseen completion across all surfaces: passive focus alone never clears `needs_review`; only a successful user action that opens the thread/review surface with the completed result visible, or an explicit mark-read/review action if one already exists, can transition the session to seen idle.

## Scope Boundaries

- No change to the underlying XState session machine state graph unless implementation reveals a genuine lifecycle bug.
- No new user-facing column taxonomy beyond the current board semantics.
- No drag-and-drop, manual status assignment, or kanban-only state ownership.
- No transport/protocol changes to ACP or Tauri session events.

### Deferred to Separate Tasks

- Reconsidering whether the board should rename `needs_review` back to `finished` at the data-model layer is outside this refactor; this plan preserves current UX semantics while fixing ownership.
- Repo-wide removal of `SessionStatus` outside the audited desktop consumers in this plan is out of scope; any remaining adapter or DTO cleanup becomes a follow-up once the new ownership boundary is proven in use.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/logic/session-machine.ts` — authoritative content/connection lifecycle states.
- `packages/desktop/src/lib/acp/logic/session-ui-state.ts` — current runtime/UI derivations from the machine snapshot.
- `packages/desktop/src/lib/acp/store/session-state.ts` — layered union that already points toward the right modeling shape, but is derived in multiple places.
- `packages/desktop/src/lib/acp/store/thread-board/build-thread-board.ts` — pure board classifier with better plan-mode fallback than queue classification.
- `packages/desktop/src/lib/acp/store/queue/queue-section-utils.ts` — queue classifier that overlaps thread-board logic but has different precedence and defaults.
- `packages/desktop/src/lib/acp/store/queue/utils.ts` — queue snapshot builder that still reconstructs session meaning before queue classification.
- `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte` — current glue that converts runtime state back into `SessionStatus` and marks unseen items as seen during render.
- `packages/desktop/src/lib/components/main-app-view/components/app-queue-row.svelte` — queue consumer that still derives local status and acknowledgement behavior.
- `packages/desktop/src/lib/acp/store/tab-bar-utils.ts` and `packages/desktop/src/lib/components/ui/session-item/session-item.svelte` — additional surfaces reading or rebuilding status semantics.

### Institutional Learnings

- `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md` — panel-backed thread state must remain the shared runtime owner; kanban cannot own a parallel model.
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` — policy/identity meaning must not leak into UI projections; shared code should consume explicit contracts.
- `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md` — separate closely related but distinct UI/runtime concerns instead of forcing one overloaded “latest status” concept to serve multiple jobs.

### External References

- None. The codebase already has sufficient local patterns and failure history for this refactor.

## Key Technical Decisions

- Introduce a single store-layer `SessionWorkProjection` (name subject to implementation) as a **sibling read model** adjacent to `session-state.ts`, not an extension of `SessionState`.
- Keep the projection consumer-neutral: it owns stable orthogonal semantics such as connection, activity, blocker, attention, effective intent, error state, and acknowledgement eligibility. It must not carry UI copy strings.
- Add one shared selector layer, adjacent to the projection, that maps projection semantics into board columns, queue sections, compact activity kind, acknowledgement eligibility, pause subtype, and related **semantic** status outputs. Queue and kanban do not each own a separate classifier.
- Expose the projection through one store-owned read seam so consumers stop assembling raw machine/interaction/unseen inputs independently.
- Keep lifecycle truth in the machine and store-layer runtime inputs; the new projection is a consumer-facing read model, not a replacement for the state machine.
- Remove render-time seen/unseen mutation from kanban. Explicit acknowledgement handlers own the transition from unseen completion to seen idle, and passive focus alone does not count as acknowledgement.
- Delete or contain stale status surfaces that imply canonical meaning without being maintained, especially `hotState.sessionState` and kanban-local `toSessionStatus(...)`.

## Canonical Precedence Matrix

This matrix defines the intended user-visible semantics that the shared selectors must preserve. It is the authority for characterization and regression tests; existing implementation behavior is reference material only when it matches this matrix.

| Situation | Canonical projection meaning | Shared selector output |
|---|---|---|
| Pending question, permission, or plan approval | blocked on user input | `answer_needed` wins over all other active states |
| Active plan-mode thinking/streaming work | active work with plan intent | board `planning`, queue `planning`, compact activity `thinking` or `streaming` |
| Active non-plan thinking/streaming work | active work with non-plan intent | board `working`, queue `working`, compact activity `thinking` or `streaming` |
| Paused plan/non-plan work | active work, paused subtype | board/queue remain in active-work family (`planning` or `working` based on intent); compact consumers may show paused-specific icon/text |
| Idle with unseen completion | completed + unacknowledged | board `needs_review`, queue `needs_review`, compact copy “Ready for review” |
| Idle with seen completion | resting, no special attention | board `idle`, queue omitted from active list, compact consumers show resting/default state |
| Error with no pending input | failed session state | board/queue `error`, compact error badge/text |
| Error with pending input | user action still blocks progress | `answer_needed` wins because the next actionable step is user response; surfaces must still retain a secondary error affordance/detail path |

## Acknowledgement Contract

`needs_review` transitions to seen idle only through a successful explicit acknowledgement path. In scope for this refactor:

- Acknowledgement means the user intentionally reached a result-bearing surface and the completed result is rendered there, or they invoked an explicit mark-read/review action if one already exists.
- Opening a thread or review surface in a way that reveals the completed result counts as acknowledgement.
- An existing explicit review/mark-read action, if present on a surface, counts as acknowledgement.
- Passive focus alone does **not** count.
- Failed navigation, failed dialog open, or focus changes that do not reveal the completed result do **not** count.

All surfaces that can acknowledge completed work must route through one shared store-layer action/API rather than clearing unseen state locally.

### Acknowledgement Entry Matrix

| Surface / entry point | Counts as acknowledgement? | Why |
|---|---|---|
| Kanban card open into thread/review dialog | Yes | Explicit user action to reveal completed result |
| Queue/sidebar row select that successfully opens the result-bearing thread/review surface | Yes | Explicit reveal path once the result is actually shown |
| Completion notification **View** action | Yes | Explicit reveal path |
| Existing explicit review / mark-read action | Yes | Explicit acknowledgement by definition |
| Passive tab focus or panel focus | No | Focus alone is not intentional review |
| Render, hydration, selection highlight, or board iteration | No | Display-only behavior must not mutate acknowledgement state |
| Compact status consumers (session row, tab badge, agent-panel mapper) | No | These are display-only consumers, not acknowledgement owners |

## Open Questions

### Resolved During Planning

- Where should the canonical status contract live? In the desktop ACP store/runtime layer, adjacent to `session-state.ts`, so UI surfaces consume a projection instead of rebuilding policy.
- Which existing classifier should be treated as closer to the intended semantics? `build-thread-board.ts` is the better starting point because it already distinguishes effective plan mode from `state.activity.modeId` when `currentModeId` is absent.
- Should the projection expose final board/queue classifications directly? No. The projection owns stable semantics; one shared selector layer derives board/queue outputs from it.
- What is the ownership model? `SessionState` remains the normalized runtime snapshot; `SessionWorkProjection` is a sibling read model and the only UI-semantic authority; `SessionStatus` remains only as an adapter/store-edge input until a follow-up audit removes more of it.
- How should unseen completion transition to idle? Through explicit acknowledgement actions that reveal completed work; passive focus alone does not count.
- What user-facing naming contract should this refactor preserve? Model term `needs_review`, compact UI copy “Ready for review”, and `finished` treated as legacy/origin terminology only.

### Deferred to Implementation

- Which existing explicit acknowledgement entry points already guarantee visible completed content versus needing a small wiring adjustment.
- Whether paused compact UI should use a dedicated icon/text everywhere or only on surfaces that already distinguish paused from generic active work.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

| Input | Canonical meaning | Derived output |
|---|---|---|
| Machine snapshot (`content`, `connection`) | lifecycle phase | projection axes |
| Pending interaction snapshot | blocker / answer-needed state | projection blocker state |
| Effective mode + streaming tool context | work intent | planning vs working |
| Unseen completion state | completion + acknowledgement axes | `needs_review` eligibility |
| Explicit acknowledgement events | seen transition | stable `needs_review`-to-idle lifecycle |

Directional shape:

```text
machine snapshot
 + pending interaction snapshot
 + effective mode/tool context
 + unseen/acknowledgement state
 -> session work projection
    -> shared selectors
       -> board column
       -> queue section
       -> compact semantic status outputs
       -> session/tab badges
```

## Implementation Units

- [ ] **Unit 1: Define the canonical session work projection**

**Goal:** Establish one store-layer contract that describes a session’s work state and one shared selector seam that turns those semantics into consumer-facing classifications.

**Requirements:** R1, R2, R3, R5

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src/lib/acp/store/session-work-projection.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-work-projection.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-state.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/logic/session-ui-state.ts`

**Approach:**
- Define a projection that separates orthogonal axes (connection, activity, blocker, attention, intent/effective mode) from surface outputs.
- Derive plan-mode status from effective runtime state, not only `currentModeId`, so resumed/streaming sessions cannot lose planning classification when display metadata is incomplete.
- Define shared selectors beside the projection for board column, queue section, and compact activity/status affordances so consumers stop owning separate classification logic.

**Execution note:** Start with characterization tests built from the canonical precedence matrix in this plan. Existing queue/board behavior should be preserved only where it matches that matrix.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/session-state.ts`
- `packages/desktop/src/lib/acp/store/thread-board/build-thread-board.ts`
- `packages/desktop/src/lib/acp/logic/session-ui-state.ts`

**Test scenarios:**
- Happy path — plan-mode streaming session derives `planning` board state and planning intent even when `currentModeId` is null but the streaming activity carries the plan mode.
- Happy path — non-plan streaming or thinking session derives `working`.
- Happy path — idle session with unseen completion derives `needs_review`; the same session with seen completion derives `idle`.
- Edge case — pending question, permission, or plan approval overrides active streaming and classifies as `answer_needed`.
- Edge case — paused session remains active work, preserves plan intent when applicable, and does not collapse to idle.
- Edge case — error with pending input still classifies as `answer_needed` because user response is the next actionable step.
- Error path — connection error wins when there is no pending input, and carries error text without suppressing the underlying session identity.
- Integration — selectors derived from the projection match the canonical precedence matrix across queue and board cases.

**Verification:**
- One projection module plus shared selectors can fully describe the session work state needed by queue, kanban, and compact status consumers without additional status reconstruction helpers.

- [ ] **Unit 2: Rewire queue and thread-board classification to consume the projection**

**Goal:** Make queue sections and kanban columns read the same canonical classification rules from one store-owned projection seam.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/queue/utils.ts`
- Modify: `packages/desktop/src/lib/acp/store/queue/queue-section-utils.ts`
- Modify: `packages/desktop/src/lib/acp/store/queue/queue-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/thread-board/build-thread-board.ts`
- Modify: `packages/desktop/src/lib/acp/store/thread-board/thread-board-item.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/app-queue-row.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`
- Test: `packages/desktop/src/lib/acp/store/queue/__tests__/queue-sections.test.ts`
- Test: `packages/desktop/src/lib/acp/store/queue/__tests__/queue-utils.test.ts`
- Test: `packages/desktop/src/lib/acp/store/thread-board/__tests__/build-thread-board.test.ts`

**Approach:**
- Replace queue-local and board-local status precedence logic with shared selector outputs derived from the projection.
- Remove the current drift where queue classification depends on `currentModeId` directly while thread-board can fall back to activity-carried mode.
- Keep queue-specific filtering/sorting concerns in queue code, but make section identity come from the shared selector layer rather than a second classifier.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/thread-board/build-thread-board.ts`
- `packages/desktop/src/lib/acp/store/queue/queue-section-utils.ts`

**Test scenarios:**
- Happy path — the same session input lands in `planning` for both queue and kanban when plan-mode work is active.
- Happy path — seen idle sessions stay out of the active queue but still land in the board’s idle column.
- Edge case — pending input takes precedence over streaming for both queue and board.
- Edge case — paused plan-mode session is treated as active work consistently across queue and board.
- Error path — error sessions do not silently fall back to `needs_review` or `working` because of consumer-specific default branches.
- Integration — a queue-built session item and a thread-board source built from the same session produce matching section/column outputs.

**Verification:**
- Queue and kanban classification tests assert one consistent precedence order and no longer need separate semantic exceptions.

- [ ] **Unit 3: Move acknowledgement lifecycle out of render-time and focus-driven mutations**

**Goal:** Ensure finished-to-idle transitions happen through explicit user interaction, not during component rendering.

**Requirements:** R2, R4, R7

**Dependencies:** Units 1, 2

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/app-queue-row.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view.svelte`
- Modify: `packages/desktop/src/lib/acp/store/unseen-store.svelte.ts`
- Test: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/unseen-store.test.ts`

**Approach:**
- Remove the current `$effect` that marks every `needs_review` kanban item as seen while iterating board groups.
- Remove focus-driven seen transitions as an ownership mechanism and replace them with one shared acknowledgement action/API that is invoked only by successful explicit acknowledgement flows.
- Keep board rendering pure: it should display the current projection, never mutate it.

**Execution note:** Add a failing regression test that proves merely rendering the kanban board does not clear unseen completion.

**Patterns to follow:**
- `packages/desktop/src/lib/components/main-app-view.svelte`
- `packages/desktop/src/lib/components/main-app-view/components/app-queue-row.svelte`
- `packages/desktop/src/lib/acp/store/unseen-store.svelte.ts`

**Test scenarios:**
- Happy path — opening a finished/needs-review thread from kanban clears unseen state and the next derived projection moves it to idle.
- Happy path — queue/sidebar selection clears unseen state only when it successfully opens the result-bearing surface.
- Edge case — rendering kanban with a needs-review session does not clear unseen state until the user interacts.
- Edge case — passive tab/panel focus does not clear unseen state.
- Edge case — background-created live panels remain unaffected; seen/unseen only changes for the reviewed session.
- Error path — failure to open a dialog or failure to reveal the completed result does not prematurely clear unseen state.
- Integration — the shared acknowledgement action updates board, queue, and compact-status consumers consistently once Unit 4 lands.

**Verification:**
- Board column changes are explainable from user actions and store updates, with no render-time side effects.

- [ ] **Unit 4: Rewire compact session consumers and remove local status reconstruction**

**Goal:** Make tab/session badges, compact session rows, kanban card status text, and compact activity/status indicators consume the canonical projection instead of rebuilding their own status helpers.

**Requirements:** R1, R3, R5

**Dependencies:** Units 1, 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/tab-bar-utils.ts`
- Modify: `packages/desktop/src/lib/components/ui/session-item/session-item.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`
- Modify: `packages/desktop/src/lib/acp/components/activity-entry/activity-entry-projection.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/session-status-mapper.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/tab-bar-utils.test.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/tab-bar-store.test.ts`
- Test: `packages/desktop/src/lib/acp/components/session-list/__tests__/session-list-logic.test.ts`
- Test: `packages/desktop/src/lib/acp/components/activity-entry/__tests__/activity-entry-projection.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/session-status-mapper.test.ts`

**Approach:**
- Replace `toSessionStatus(...)`, queue-local status inference, and stale `hotState.sessionState` reads with projection-backed fields.
- Keep UI-only label/icon choices in the UI layer, but make them map from canonical projection outputs rather than raw transport-era statuses.
- Ensure compact “thinking”, “streaming”, “Ready for review”, paused, and error semantics come from the same projection/selectors used by queue and kanban.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/activity-entry/activity-entry-projection.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/session-status-mapper.ts`

**Test scenarios:**
- Happy path — session-item, tab bar, and kanban card all show the same active state for a thinking session.
- Happy path — unseen completion shows review-ready status text/badge consistently across compact consumers.
- Edge case — paused sessions retain active-work visuals without being treated as disconnected, and surfaces that already distinguish paused continue to render paused-specific treatment.
- Edge case — idle restored sessions do not show review badges or active-work affordances.
- Error path — error badge/text comes from projection error state rather than divergent fallbacks per consumer.
- Integration — changing one session’s projection updates only that session’s compact consumers, preserving fine-grained reactivity expectations.

**Verification:**
- No compact UI consumer needs to reconstruct session work semantics from `SessionStatus` plus local exceptions.

- [ ] **Unit 5: Remove dead or misleading status surfaces and lock the architecture with regression coverage**

**Goal:** Finish the refactor by deleting stale desktop-local abstractions, tightening store contracts, and documenting the new ownership boundary through tests.

**Requirements:** R3, R4, R5

**Dependencies:** Units 1, 2, 3, 4

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/types.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-hot-state-store.svelte.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-state.test.ts`
- Test: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-hot-state-store.vitest.ts`

**Approach:**
- Remove or sharply constrain dead fields that imply canonical session-work meaning without being maintained.
- Remove or constrain stale desktop-local status surfaces first (`hotState.sessionState`, kanban-local reconstruction helpers, duplicated queue/thread-board semantics, local queue/tab-session-summary rebuilding seams). Do not change cross-layer DTO contracts in this unit.
- Document the surviving `SessionStatus` boundary explicitly: it may remain at adapter and legacy store edges until a separate audited follow-up proves it can be removed safely.
- Preserve the existing fine-grained reactive store strategy while making status ownership explicit in code and tests.

**Execution note:** Treat this as a cleanup unit only after the projection-backed consumers are green; do not delete legacy state surfaces before replacement coverage exists.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/types.ts`
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`

**Test scenarios:**
- Happy path — store APIs expose one obvious way to read session work status for UI consumers.
- Edge case — no consumer relies on an unmaintained `hotState.sessionState` field after the refactor.
- Error path — cleanup does not regress session connection error propagation or machine-driven runtime updates.
- Integration — a shared board/queue/tab-session-summary regression fixture proves the same session input stays aligned across all audited surfaces.

**Verification:**
- The codebase has one documented ownership boundary for session work status, and regression tests fail if a new surface reintroduces local classification logic.

## System-Wide Impact

- **Interaction graph:** session machine + interaction snapshots + unseen store feed the session work projection; queue, thread-board, kanban cards, tabs, and session rows consume that projection.
- **Error propagation:** machine/runtime errors remain machine-owned; the projection only classifies and exposes them consistently to consumers.
- **State lifecycle risks:** incorrect seen/unseen ownership could cause premature idle transitions; projection wiring must avoid render-triggered writes, exclude passive focus from acknowledgement, and preserve explicit user acknowledgement.
- **API surface parity:** queue and thread-board must continue exposing their current public shapes to presentational components, even if their classification internals move behind the projection.
- **Integration coverage:** board, queue, and compact-session surfaces need a shared regression harness or mirrored fixtures so the same session case is asserted across all consumers.
- **Unchanged invariants:** panel-backed session ownership, kanban as a layout mode, and the current XState lifecycle phases remain unchanged by this refactor.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Refactor stops halfway and leaves mixed status sources in place | Sequence the work so the projection lands first, then move consumers in dependency order, then delete stale surfaces last |
| Queue and kanban semantics regress because current differences were accidental but relied upon | Use the canonical precedence matrix as the source of truth, then add shared fixtures across queue and board tests |
| Seen/unseen lifecycle becomes too eager or too sticky | Move the transition to one shared acknowledgement action and add regression coverage for “render only”, “successful reveal”, and failure cases |
| Fine-grained reactivity regresses if consumers over-read store state | Keep projection derivation at the store/session level and test that per-session updates remain isolated |

## Documentation / Operational Notes

- After implementation, add a solution doc if the refactor exposes a durable pattern for “one runtime owner, many UI projections” beyond this specific status system.
- The follow-up `/document-review` pass should focus on whether the plan fully removes local status dialects or accidentally preserves them behind new names.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-03-31-kanban-view-requirements.md`
- Related code: `packages/desktop/src/lib/acp/logic/session-ui-state.ts`
- Related code: `packages/desktop/src/lib/acp/store/thread-board/build-thread-board.ts`
- Related code: `packages/desktop/src/lib/acp/store/queue/queue-section-utils.ts`
- Related code: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`
- Institutional reference: `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md`
- Institutional reference: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- Institutional reference: `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md`

---
title: fix: Prevent assistant streaming cross-turn contamination
type: fix
status: active
date: 2026-04-18
---

# fix: Prevent assistant streaming cross-turn contamination

## Overview

Fix the assistant streaming store so a new semantic assistant response cannot silently merge into an older assistant entry just because the same `message_id` reappears. The current code intentionally preserves some assistant aggregation identity across `turnComplete` to support legitimate trailing chunks, but that same behavior leaves no safe boundary for provider-side message rewrites, replay overlap, or cross-turn `message_id` reuse. This plan hardens the existing chunk/event pipeline without taking on the broader canonical transcript-projection refactor.

## Problem Frame

The user-visible symptom is not just mid-stream markdown awkwardness. The persisted final assistant text can contain duplicated or interleaved content, which means the corruption happens before rendering. Current code and tests confirm the relevant constraints:

- `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts` intentionally does **not** clear assistant aggregation state on `handleStreamComplete()` so trailing assistant chunks without `message_id` can still merge into the same entry.
- `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts` clears only in-memory aggregation state in `clearStreamingAssistantEntry()`.
- `packages/desktop/src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts` explicitly asserts that after `clearStreamingAssistantEntry()`, a later chunk with the same `messageId` still merges into the old assistant entry. That test documents the current broken behavior and must flip as part of this fix.
- `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts` currently allows that merge because `resolveChunkAction()` only asks whether an assistant entry with the resolved entry id still exists, and `assistantEntryExists()` treats any historical assistant entry with that id as mergeable.
- `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts` already treats transcript deltas as a stronger source by clearing pending assistant fallback batches when an assistant delta arrives, but once fallback chunks have already written to the store there is still no explicit rule that retires chunk-based continuation ownership.

| Situation | Current behavior | Required behavior |
|---|---|---|
| Same-turn chunks with the active `message_id` | Merge into one assistant entry | Keep this |
| Trailing post-turn chunk without `message_id` | Merge into the just-finished assistant entry | Keep this |
| New semantic assistant content reusing an old `message_id` | May merge into the old assistant entry | Must start a new assistant entry or replace via the authoritative path |
| Assistant transcript delta arrives after fallback chunk activity | Pending fallback is cleared, but already-written store content may still share identity ambiguously | Transcript-authoritative updates must not leave duplicated stored text |
| A reused `message_id` was previously remapped through `postBoundaryMap` | May reroute into the old post-tool assistant entry | Must not revive a retired post-boundary mapping for a new semantic response |

| Stream phase | Allowed merge target | Not allowed |
|---|---|---|
| Active streaming before `turnComplete` | Active assistant continuation for the current response | Historical assistant entry resurrection from a retired response |
| Narrow post-turn carryover window | Only unlabeled continuation for the just-finished response, plus existing carryover semantics already covered by current boundary tests | Treating any new explicit `message_id` reuse as safe carryover by default |
| After `clearStreamingAssistantEntry()` or after a new authoritative assistant source arrives | None from historical chunk state; create new assistant state or follow transcript-authoritative update path | Any merge based only on the existence of an older assistant entry with the same id |

This bug should be fixed now as a focused compatibility repair. The broader transcript architecture plan at `docs/plans/2026-04-16-003-refactor-canonical-streaming-projection-plan.md` remains the long-term cleanup path, but this issue is narrow enough to fix safely in the current architecture.

## Requirements Trace

- R1. Persisted assistant text must not merge new semantic assistant content into an older assistant entry solely because an old `message_id` matches.
- R2. Trailing assistant chunks that legitimately belong to the just-completed response, especially chunks without `message_id`, must continue to merge into the existing assistant entry instead of fragmenting.
- R3. Transcript-delta-authoritative assistant updates must not duplicate or contaminate already stored assistant text.
- R4. Existing tool-boundary, thought/message split, and replay behavior that currently works must remain intact.
- R5. The fix must begin with failing characterization coverage for the contamination cases and keep regression coverage at the store/event seam.

## Scope Boundaries

- Do not implement the broader transcript-projection architecture from `docs/plans/2026-04-16-003-refactor-canonical-streaming-projection-plan.md` in this fix.
- Do not redesign `markdown-text.svelte`, reveal pacing, or live markdown rendering for this bug.
- Do not change provider transport payloads or Rust-side streaming contracts unless current frontend tests prove the bug cannot be fixed at the existing frontend ownership seam.
- Do not remove the existing post-tool and post-turn carryover behavior unless characterization proves it is the direct source of corruption and a narrower replacement exists.

### Deferred to Separate Tasks

- Full replacement of the current chunk/replay pipeline with canonical transcript snapshot-plus-delta ownership.
- Streaming UX polish or live-markdown improvements unrelated to stored-text correctness.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/logic/chunk-action-resolver.ts` owns the merge-vs-create decision and currently resolves assistant identity from `lastKnownMessageId`, `pendingBoundaries`, `postBoundaryMap`, and historical entry existence.
- `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts` owns the per-session `AggregationState` and is the narrowest place to redefine live continuation ownership.
- `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts` owns the current post-`turnComplete` carryover rule that preserves trailing unlabeled assistant chunks.
- `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts` owns fallback assistant chunk application, replay duplicate handling, and transcript-delta application ordering.
- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts` owns transcript delta application into session entries and remains the canonical store seam for this fix.
- `packages/desktop/src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts` already captures several boundary behaviors, including the currently allowed merge-after-clear behavior.
- `packages/desktop/src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts` already protects the legitimate trailing post-turn chunk behavior.
- `packages/desktop/src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts` already checks end-to-end grouped assistant text so it is a good regression target for “stored text is wrong, not just rendered text.”

### Institutional Learnings

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` — identity and lifecycle policy should come from owned runtime contracts, not from heuristics or UI-level reconstruction.
- `docs/solutions/integration-issues/copilot-permission-prompts-stream-closed-2026-04-09.md` — cross-layer bugs need regression tests at the contract seam, not only isolated helper tests.
- `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md` — separate “what is growing now” from “what is visible historically”; this same principle applies to live assistant continuation vs historical entry identity.

### External References

- None. The current codebase and existing plans provide enough grounding for this targeted fix.

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| Create a new narrow fix plan instead of folding this into the canonical projection refactor. | The bug is current, reproducible, and sits at a well-defined seam in the existing frontend pipeline. Waiting for the larger refactor would leave persisted transcript corruption unfixed. |
| Treat live assistant continuation ownership as a stricter concept than “historical entry exists for this `message_id`.” | The confirmed bug comes from reusing historical identity too freely after the stream boundary has moved on. |
| Resolve the core ownership change inside `AggregationState` and `resolveChunkAction`, with lifecycle events only deciding when continuation is retired. | This keeps the central merge rule in one place. `SessionEventService` and `SessionMessagingService` should trigger boundary changes, but they should not carry their own parallel definition of what counts as a mergeable historical entry. |
| Preserve post-turn carryover for unlabeled trailing chunks as a first-class invariant. | Existing tests and code comments show this behavior is intentional and user-visible. The fix must not reintroduce one-word fragment entries after `turnComplete`. |
| Keep transcript delta application authoritative once assistant deltas arrive. | When both fallback chunks and transcript deltas can shape assistant text, the stronger contract must win without leaving duplicated stored text behind. |
| Prefer retiring chunk-based continuation on first assistant transcript delta rather than replacing stored assistant entries wholesale. | Early retirement is the narrower repair. Whole-entry replacement stays available only if characterization proves duplicated text can already be persisted before the delta arrives. |
| Start with characterization at the store/event seam, not the markdown renderer. | The confirmed symptom is corrupted persisted text, so the plan should not chase render-only fixes first. |

## Open Questions

### Resolved During Planning

- **Is this only a markdown-rendering bug?** No. The stored assistant text itself can be wrong, so the first fix seam is upstream of rendering.
- **Should this plan replace the broader canonical streaming projection work?** No. This is a focused hardening fix in the existing architecture.
- **Must the fix preserve trailing post-turn chunks without `message_id`?** Yes. Current code intentionally supports that case and existing tests protect it.
- **Should the fix rely on replay dedupe windows as the primary safeguard?** No. Replay dedupe is hygiene, not semantic ownership.
- **Where does the core merge-permission rule live?** In `AggregationState` plus `resolveChunkAction()`. Event-layer services decide when to retire or preserve continuation, but they do not define mergeability independently.
- **What is the carryover rule after `turnComplete`?** The preserved invariant is narrow: keep unlabeled trailing continuation for the just-finished response, but do not treat later explicit `message_id` reuse as safe carryover by default.
- **How should transcript-authoritative repair behave?** Prefer retiring chunk-based continuation on the first assistant transcript delta. Only use store-level replacement if characterization proves duplication can already be persisted before retirement occurs.

### Deferred to Implementation

- None beyond implementation-level naming and exact helper boundaries.

## Implementation Units

- [ ] **Unit 1: Characterize the contamination sequences with failing store/event tests**

**Goal:** Prove the current failure modes in code so the fix preserves legitimate carryover while blocking historical-entry contamination.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts`

**Approach:**
- Add a focused regression case showing that once assistant streaming state is cleared, a later assistant chunk with the same explicit `message_id` should no longer be allowed to resurrect the old assistant entry by historical index alone.
- Invert the existing `clearStreamingAssistantEntry clears tracker but same messageId still merges...` expectation so the test documents the corrected behavior instead of the current bug.
- Add a transcript-delta-over-fallback characterization that proves assistant-authoritative delta activity must not leave duplicated persisted text.
- Keep the existing post-turn trailing-unlabeled-chunk scenario as a must-pass characterization in the same test sweep so the bug fix has a clear safety rail.

**Execution note:** Add failing characterization coverage first and verify at least one contamination test fails on current behavior before changing runtime code.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/__tests__/chunk-aggregation-bug.test.ts`
- `packages/desktop/src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts`
- `packages/desktop/src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`

**Test scenarios:**
- Happy path: same-turn chunks with one `message_id` still merge into one assistant entry.
- Edge case: after assistant streaming state is cleared, a new assistant chunk reusing the same explicit `message_id` starts a fresh assistant entry instead of mutating the historical one.
- Edge case: trailing assistant chunk after `turnComplete` with `message_id: undefined` still merges into the just-completed assistant entry.
- Integration: assistant transcript delta arrival after fallback chunk activity does not leave duplicated stored assistant text.
- Error path: replay duplicate suppression remains transport-scoped and does not hide a semantic rewrite case from the store.

**Verification:**
- At least one new regression test fails on current code for cross-turn contamination while the legitimate post-turn carryover test still describes the intended invariant.

- [ ] **Unit 2: Redefine chunk aggregation ownership so historical `message_id` lookup cannot cross stream boundaries**

**Goal:** Change assistant aggregation so live continuation is explicit and bounded, rather than inferred from any historical assistant entry with the same `message_id`.

**Requirements:** R1, R2, R4, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/chunk-action-resolver.ts`
- Modify: `packages/desktop/src/lib/acp/logic/chunk-aggregation-types.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts`

**Approach:**
- Add an explicit retired-continuation concept to `AggregationState` so `resolveChunkAction()` can distinguish live continuation from historical assistant entry identity.
- Keep the existing tool-boundary and carryover mapping semantics where they are still valid for one logical response, but stop using stale historical assistant entry existence as permission to merge after the stream has been explicitly cleared or retired.
- Apply the guard before both direct entry-id merge and any `postBoundaryMap` remap can revive an older assistant entry for a new semantic response.
- Preserve the current behavior for `boundaryCarryover` and legitimate post-tool/post-turn continuation so this change only closes the contamination seam.

**Execution note:** Implement against the failing regression tests from Unit 1; do not widen scope into unrelated chunk-normalization or render logic.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/logic/chunk-action-resolver.ts`
- `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`
- `packages/desktop/src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts`

**Test scenarios:**
- Happy path: repeated same-turn chunks with the active `message_id` still merge.
- Happy path: post-tool chunks with the same logical response still create the correct new post-tool assistant entry and continue merging there.
- Edge case: clearing assistant streaming ownership prevents historical resurrection by explicit reused `message_id`.
- Edge case: a reused `message_id` that previously had a `postBoundaryMap` remap does not route into an old post-tool assistant entry.
- Edge case: undefined chunks immediately following a valid active assistant entry still use the allowed carryover path.
- Integration: grouped assistant text after a tool boundary remains correct and non-duplicated.
- Error path: missing-session and invalid-input behavior remains unchanged.

**Verification:**
- The aggregator can still express all currently intended boundary cases, but no longer merges new semantic content into an old assistant entry solely through stale historical identity.

- [ ] **Unit 3: Tighten session-event authority around `turnComplete`, fallback chunks, and transcript deltas**

**Goal:** Make the event pipeline explicit about when assistant continuation is still valid and when transcript-authoritative updates retire that ownership.

**Requirements:** R2, R3, R4, R5

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts`

**Approach:**
- Define the exact carryover window the current architecture still supports after `turnComplete`.
- Ensure assistant transcript deltas retire chunk-fallback continuation for the same logical response on first assistant mutation, with `session-entry-store.svelte.ts` as the explicit store seam that enforces the transcript-authoritative handoff.
- Keep whole-entry replacement as an implementation fallback only if Unit 1 characterization proves duplicated text can already be persisted before continuation retirement occurs.
- Keep replay duplicate-window handling as a transport optimization, not as the semantic boundary that decides whether stored assistant text is safe to merge.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
- `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`

**Test scenarios:**
- Happy path: a legitimate trailing unlabeled assistant chunk after `turnComplete` still lands on the completed assistant entry.
- Edge case: once a new user chunk or new assistant-authoritative stream begins, the previous assistant entry is no longer eligible for merge by stale identity alone, even if the explicit `message_id` matches a prior entry.
- Integration: transcript delta with assistant mutation clears fallback ownership before duplicated stored text can form.
- Integration: replayed non-streaming assistant chunks continue to dedupe within the existing replay window without altering current streaming behavior.
- Error path: stream error and turn error paths still clear assistant continuation state consistently.

**Verification:**
- Event-order-sensitive tests demonstrate one authoritative assistant text path per logical response, with the intentional post-turn carryover case preserved.

- [ ] **Unit 4: Lock the persisted-text regression with a user-shaped end-to-end store assertion**

**Goal:** Add one regression that stays close to the observed symptom: final assistant text must not contain duplicated sections even if intermediate chunk/event ordering is messy.

**Requirements:** R1, R3, R5

**Dependencies:** Unit 3

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts`
- Maybe modify: `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`

**Approach:**
- Use the existing store-to-grouped-text test seam to replay a user-shaped contamination sequence rather than a renderer-only snapshot.
- Assert on final grouped assistant text so the regression covers the persisted transcript surface the user actually observed.
- Prefer one realistic “rewritten/reused assistant identity” sequence over many synthetic micro-cases.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts`
- `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`

**Test scenarios:**
- Happy path: a normal tool/message sequence still yields clean grouped final text.
- Integration: a rewritten or replay-overlapped assistant sequence no longer produces duplicated headings/paragraphs in final grouped text.
- Edge case: the same regression path stays green whether the final assistant text arrives through chunk aggregation only or through transcript-authoritative update ordering.
- Error path: if a reproduced sequence never receives transcript-authoritative assistant deltas, tightened chunk ownership alone still prevents a second copy of the same logical assistant content from being appended.

**Verification:**
- The reported symptom class is covered by a persisted-text regression, not only by low-level state tests.

## System-Wide Impact

- **Interaction graph:** `SessionEventService` receives assistant chunks and transcript deltas, `SessionMessagingService` manages turn lifecycle, `ChunkAggregator` resolves continuation ownership, `SessionEntryStore` persists assistant entries, and grouped assistant text/rendering consume the stored result.
- **Error propagation:** invalid or missing-session inputs should continue returning typed errors through existing `ResultAsync` boundaries; this fix should not add silent fallbacks or broad catch behavior.
- **State lifecycle risks:** the main risk is over-clearing assistant continuation state and fragmenting legitimate trailing chunks; the opposite risk is under-clearing and keeping cross-turn contamination alive.
- **API surface parity:** live streaming, replay hydration, and transcript-delta paths all touch the same assistant-entry store contract and must agree on ownership.
- **Integration coverage:** unit tests on the resolver are not enough; the plan requires event-order-sensitive tests that cover chunk fallback, turn completion, and transcript delta interaction together.
- **Unchanged invariants:** tool-call boundary splitting, thought/message chunk typing, markdown rendering, and the broader canonical-projection refactor plan remain out of scope for this fix.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| The fix breaks legitimate post-turn unlabeled chunk carryover and reintroduces fragmented one-word assistant entries. | Keep the existing `session-messaging-service-stream-lifecycle` carryover case as a must-pass regression from the first unit onward. |
| The plan fixes only one contamination path while a second chunk-vs-delta overlap remains. | Characterize both historical-id reuse and transcript-delta interaction before changing runtime code. |
| The narrow fix drifts away from the future canonical projection architecture. | Keep the design local to current ownership seams and reference the broader plan as the long-term replacement, not a competing model. |

## Documentation / Operational Notes

- No user-facing documentation changes are required for this bug fix.
- When implementation lands, note in the PR description that this is a compatibility hardening fix under the current streaming architecture and does not supersede `docs/plans/2026-04-16-003-refactor-canonical-streaming-projection-plan.md`.

## Sources & References

- Related plan: `docs/plans/2026-04-16-003-refactor-canonical-streaming-projection-plan.md`
- Related requirements: `docs/brainstorms/2026-04-15-streaming-markdown-during-reveal-requirements.md`
- Related code: `packages/desktop/src/lib/acp/logic/chunk-action-resolver.ts`
- Related code: `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`
- Related code: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
- Related learning: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- Related learning: `docs/solutions/integration-issues/copilot-permission-prompts-stream-closed-2026-04-09.md`

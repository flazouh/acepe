---
title: "fix: Remove elapsed seconds from planning next moves labels"
type: fix
status: active
date: 2026-04-14
---

# fix: Remove elapsed seconds from planning next moves labels

## Overview

Stop the shared **"Planning next moves…"** placeholder from rendering elapsed seconds such as `for 4s…`, while preserving timed **Thinking** / **Thought** labels on actual thought-bearing assistant messages. This keeps the planning indicator calm and static, but leaves duration context where the UI is explicitly presenting thought content.

## Problem Frame

The shared agent-panel entry surfaces currently render `Planning next moves for Xs…` whenever a thinking entry has `durationMs`. The user wants that elapsed-time suffix removed from the planning placeholder, with timed labels retained only on the dedicated thinking / thought assistant message surfaces. The issue is small but touches two shared renderers and an intentionally different desktop thought-message path, so the plan must preserve that distinction explicitly.

## Requirements Trace

- R1. The **Planning next moves…** placeholder never renders `for Xs` in the shared entry renderers, even when `durationMs` is present.
- R2. Timed labels remain available for true thinking/thought assistant message surfaces, such as `Thinking for 3s` and `Thought for 3s`.
- R3. Both shared panel renderers (`agent-panel` and `agent-panel-scene`) use the same planning-label logic so they cannot drift.
- R4. The existing duration pipeline (`durationMs` in entry models and virtualized display logic) remains intact for other consumers.

## Scope Boundaries

- No changes to queue status copy, blog demos, changelog copy, or message catalog text
- No changes to duration measurement in `virtualized-entry-display.ts`
- No changes to desktop `assistant-message.svelte` thinking/thought label behavior
- No changes to todo duration formatting or other timed tool labels

## Context & Research

### Relevant Code and Patterns

- `packages/ui/src/components/agent-panel/agent-panel-conversation-entry.svelte` currently renders the planning placeholder inline and appends `for ${seconds}s…` when `entry.durationMs` is present.
- `packages/ui/src/components/agent-panel-scene/agent-panel-scene-entry.svelte` duplicates the same planning-placeholder logic.
- `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte` is intentionally different: it renders `Thinking for Xs` while streaming and `Thought for Xs` after completion. This is the behavior the user wants to keep.
- `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts` already asserts the timed thinking/thought labels and is the invariant to preserve.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts` computes `durationMs` for trailing thinking indicators and merged thought entries; this data should remain available even if one label stops showing it.
- `packages/ui/src/components/agent-panel-scene/agent-panel-scene-entry.svelte` already imports shared code from `../agent-panel/`, so a shared helper in the `agent-panel` folder is feasible.

### Institutional Learnings

- No directly relevant `docs/solutions/` entry was found for planning-label wording or thinking-duration presentation.

### External References

- None. The codebase already has the local patterns needed for this fix.

## Key Technical Decisions

- **Keep `durationMs`, change only the planning label presentation:** The timing field still matters for thought-bearing messages and any future consumers, so the fix should be display-only rather than removing or nulling the data.
- **Extract one shared planning-label helper:** The two shared entry components currently duplicate the same string logic. A helper should produce the planning placeholder label once and be reused by both renderers.
- **Preserve the desktop thought-message path as a separate concern:** `assistant-message.svelte` should not be routed through the new planning helper because its timed labels are intentionally distinct and already covered by tests.

## Open Questions

### Resolved During Planning

- **What does "not have this 4x second" mean in code terms?** Remove the `for Xs` suffix from the **Planning next moves…** placeholder when `durationMs` is present.
- **Which surfaces should still show elapsed seconds?** The dedicated thinking / thought assistant message surfaces, not the generic planning placeholder rows.

### Deferred to Implementation

- **Helper placement/name:** The exact helper filename can be chosen during implementation, as long as it lives in the shared `packages/ui/src/components/agent-panel/` area and both entry renderers import the same logic.

## Implementation Units

- [ ] **Unit 1: Centralize the planning placeholder label**

**Goal:** Replace duplicated inline string formatting with one shared planning-label helper that always returns the static **Planning next moves…** label.

**Requirements:** R1, R3, R4

**Dependencies:** None

**Files:**
- Create: `packages/ui/src/components/agent-panel/planning-label.ts`
- Modify: `packages/ui/src/components/agent-panel/agent-panel-conversation-entry.svelte`
- Modify: `packages/ui/src/components/agent-panel-scene/agent-panel-scene-entry.svelte`
- Test: `packages/ui/src/components/agent-panel/planning-label.test.ts`

**Approach:**
- Move the planning-placeholder label logic into a shared helper in the `agent-panel` package.
- Have the helper ignore `durationMs` and return the static label so both renderers present the same calm placeholder.
- Update both entry components to import that helper instead of formatting the label inline.

**Patterns to follow:**
- Existing cross-folder import pattern in `packages/ui/src/components/agent-panel-scene/agent-panel-scene-entry.svelte`
- Stable timed thinking/thought labeling in `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`

**Test scenarios:**
- Happy path: helper returns `Planning next moves…` when duration is absent.
- Happy path: helper still returns `Planning next moves…` when duration is `4000`.
- Edge case: helper still returns `Planning next moves…` for `0` and sub-second durations instead of exposing raw timer churn.

**Verification:**
- Both shared entry components build against one shared helper and no longer embed duplicate planning-duration formatting.

- [ ] **Unit 2: Add regression coverage for planning-vs-thought label separation**

**Goal:** Prove the planning placeholder no longer shows elapsed seconds while timed thought/thinking labels remain intact on their dedicated surface.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1

**Files:**
- Create: `packages/ui/src/components/agent-panel/agent-panel-conversation-entry.svelte.vitest.ts`
- Create: `packages/ui/src/components/agent-panel-scene/agent-panel-scene-entry.svelte.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts` (only if an explicit invariant assertion is needed beyond the existing timed-label coverage)

**Approach:**
- Render a `thinking` entry with `durationMs` in each shared UI entry component and assert that the placeholder remains `Planning next moves…` with no `for 4s` suffix.
- Leave the desktop assistant-message tests as the timed-label source of truth; only add or tighten assertions there if implementation risks weakening that distinction.

**Patterns to follow:**
- Component render-test pattern in `packages/ui/src/components/voice-download-progress/voice-download-progress.svelte.vitest.ts`
- Existing timed-label assertions in `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`

**Test scenarios:**
- Happy path: `agent-panel-conversation-entry` renders `Planning next moves…` for a thinking entry with `durationMs: 4000`.
- Happy path: `agent-panel-scene-entry` renders `Planning next moves…` for a thinking entry with `durationMs: 4000`.
- Error path: neither shared entry test finds `Planning next moves for 4s…` in the rendered output.
- Integration: desktop assistant-message still renders `Thinking for 3s` while streaming and `Thought for 3s` when completed.

**Verification:**
- Shared entry tests fail if the planning placeholder regains elapsed seconds.
- Desktop thought/timing tests continue to prove that timed labels survive on the dedicated thought-message path.

## System-Wide Impact

- **Interaction graph:** This change only affects label selection inside shared agent-panel rendering; no callbacks, event flows, or state transitions change.
- **Error propagation:** None. The work is display-only.
- **State lifecycle risks:** The main risk is conflating the planning placeholder with the desktop thought-message label path and accidentally removing duration context from both.
- **API surface parity:** Both `agent-panel` and `agent-panel-scene` must stay in sync because they render the same conceptual thinking entry.
- **Integration coverage:** Tests should cover both shared entry components plus the separate desktop assistant-message path so the distinction is enforced, not assumed.
- **Unchanged invariants:** `durationMs` remains on thinking entries, virtualized display duration calculation remains unchanged, and desktop thought-bearing assistant messages continue to show elapsed seconds.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The fix only updates one shared renderer and the other keeps `for Xs` | Centralize the planning label in one helper imported by both components |
| Implementation accidentally removes duration labels from actual thought-bearing messages | Keep `assistant-message.svelte` out of scope for the helper and preserve its existing tests |
| A test covers only the helper but misses component wiring regressions | Add render-level regression tests for both shared entry components |

## Documentation / Operational Notes

- No docs or operational changes are expected for this presentation-only fix.

## Sources & References

- Related code: `packages/ui/src/components/agent-panel/agent-panel-conversation-entry.svelte`
- Related code: `packages/ui/src/components/agent-panel-scene/agent-panel-scene-entry.svelte`
- Related code: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts`
- Related test: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`

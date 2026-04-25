---
title: fix: Stabilize typewriter streaming animation
type: fix
status: active
date: 2026-03-30
deepened: 2026-03-30
---

# fix: Stabilize typewriter streaming animation

## Overview

Fix the assistant message typewriter so streaming text reveals progressively and consistently, without flicker, pauses, or abrupt block replacement. The current bug is most likely caused by the markdown rendering layer replacing or upgrading the DOM subtree while the typewriter reveal controller is actively animating it, with stale async markdown completions adding a second source of mid-stream replacement.

## Problem Frame

The assistant message pipeline currently combines several moving parts:

- assistant chunk aggregation and grouping
- markdown rendering with sync and async paths
- DOM-based typewriter reveal masking and block visibility control
- streaming ownership applied only to the last text group in a message

The reported behavior is inconsistent typing, intermittent stopping, flicker, and cases where streaming appears to stop and then a larger block of text appears at once. The strongest code evidence points to an integration bug at the renderer boundary rather than a pure reveal-loop bug.

The most likely failure modes are:

- stale async markdown completions overwriting newer streamed text
- the rendered subtree switching between fallback/plain/loading/HTML while streaming is still active
- the currently streaming text group changing when mixed content alters group boundaries
- index-keyed group rendering remounting the active text block when group boundaries shift
- post-render subtree mutators such as badge mounting or delayed repo-context enhancement invalidating reveal indexing

## Requirements Trace

- R1. Assistant text must reveal progressively during streaming without visible flicker or stop-start remount behavior.
- R2. Older async markdown results must never overwrite newer streamed content.
- R3. The DOM subtree observed by the typewriter controller must remain stable while streaming is active.
- R4. Final markdown formatting must still settle correctly after streaming finishes.
- R5. The fix must be implemented with focused failing regression tests first, following repo TDD rules.

## User-Visible Acceptance Criteria

- No already revealed text disappears and reappears later in the same streamed assistant message.
- No full-block pop-in occurs while `isStreaming` is still true for the active message.
- At most one final visual settle is allowed after streaming completes.
- Final settle must not duplicate text, restart the typewriter from the beginning, or flash both the incremental and final formatted versions at once.
- If markdown rendering never succeeds, the user still keeps the latest visible streamed content as the final fallback state.

## Scope Boundaries

- Do not redesign the full assistant chunk ingestion pipeline unless characterization tests prove the bug starts upstream of rendering.
- Do not rewrite the core reveal engine unless a narrower renderer-boundary fix fails to resolve the behavior.
- Do not change unrelated panel/session runtime state behavior unless instrumentation shows a real streaming-state flap.
- Do not optimize non-bug-related markdown rendering behavior while touching this path.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
  Chooses which grouped text block is marked as streaming. Today only the last text group receives `isStreaming`, and both thought/message groups are keyed by `index`, which is a remount risk when group boundaries shift.
- `packages/desktop/src/lib/acp/components/messages/content-block-router.svelte`
  Routes validated content blocks to the matching renderer.
- `packages/desktop/src/lib/acp/components/messages/acp-block-types/text-block.svelte`
  Routes text blocks through the typewriter path.
- `packages/desktop/src/lib/acp/components/messages/typewriter-text.svelte`
  Binds the DOM-based reveal controller to the rendered markdown container.
- `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
  Uses `renderMarkdownSync()` first and falls back to async `renderMarkdown()` for large or uninitialized content. Async rendering depends on more than `text`, including delayed `repoContext`, and the component also mutates the rendered subtree after render via badge mounts.
- `packages/desktop/src/lib/acp/components/messages/logic/text-reveal.ts`
  Implements the DOM masking and progressive reveal algorithm, including hide/show behavior for block-level markdown nodes.
- `packages/desktop/src/lib/acp/components/messages/logic/text-reveal-model.ts`
  Holds pure reveal-progress state and frame timing.
- `packages/desktop/src/lib/acp/components/messages/logic/typewriter-reveal-controller.ts`
  Wraps reveal lifecycle around container remounts and streaming toggles.
- `packages/desktop/src/lib/acp/utils/markdown-renderer.ts`
  Exposes the sync/async markdown rendering boundary and cache behavior.

### Institutional Learnings

- `AGENTS.md` requires bug fixes to start with a focused failing test or characterization.
- `docs/agent-guides/svelte.md` warns against creating render loops with `$effect` and favors stable state ownership with presentational children.
- Existing repo guidance for streaming state emphasizes preserving stable identity and updating existing state rather than rekeying or replacing live UI state.
- Prior bug-fix learnings in the repo favor fixing missing context or stale state at the earliest boundary instead of relying on later reconciliation.

### External References

- No external research was needed for the initial plan. The codebase already contains strong local patterns for the streaming UI and reveal logic. The main risk is internal integration between existing layers, not adoption of a new framework pattern.

## Key Technical Decisions

- Stabilize the markdown-rendering boundary before changing the core reveal engine.
  The reveal engine already has substantial targeted test coverage. The strongest evidence points to the DOM being replaced underneath it.
- Treat stale async markdown completion as a correctness bug, not a cosmetic race.
  If an older render result can commit after newer text has arrived, the visible content is wrong even if the typewriter layer behaves perfectly.
- Define async render ownership by full request identity, not text alone.
  The markdown output can also change when `repoContext` arrives later, so stale-result protection must cover the actual render inputs or use a monotonic request token owned by the component instance.
- Keep the DOM representation stable while streaming, even if that means deferring a markdown upgrade until streaming ends.
  The typewriter controller works by indexing live text nodes. Swapping the representation mid-stream invalidates its assumptions and matches the observed symptoms.
- During streaming, allow only one display mode for the active message subtree.
  The streaming contract should be: preserve the currently visible incremental subtree, defer disruptive HTML-mode upgrades and badge/enhancer mounts while `isStreaming` is true, and allow a single final settle after streaming reaches a terminal state.
- Change text-group streaming ownership only if renderer-boundary fixes are insufficient.
  The group-boundary rule is a plausible amplifier, but it should not be changed unless tests show it is part of the root cause.

## Open Questions

### Resolved During Planning

- Is the first fix target the reveal engine or the markdown/render boundary?
  The markdown/render boundary should be fixed first because it is the smallest change that matches the observed symptoms and existing code evidence.
- Should async markdown be allowed to replace the live subtree while streaming?
  No. The subtree should remain stable while streaming is active, and stale completions must be ignored.
- What does the user see during streaming?
  The user should continue seeing the currently visible incremental message subtree. Final markdown upgrades, badge mounts, and other disruptive subtree enhancements should be deferred until streaming completes, unless a specific path is proven to preserve subtree stability.

### Deferred to Implementation

- Does session runtime state briefly flap out of `running` during the reported failures?
  This must be characterized early if test evidence suggests that a transient false value could trigger an unwanted final-settle path while streaming is still active.
- Does the current last-text-group streaming rule need to change?
  This depends on characterization results after the renderer-boundary fix.

## High-Level Technical Design

> This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

```text
stream chunk arrives
  -> assistant chunk aggregation updates message text
  -> MarkdownText receives newer text
  -> current render request identity covers text + render context ownership
  -> sync path may update visible content immediately if it preserves the current subtree mode
  -> async path may start in background
  -> if async result belongs to an older request or unmounted owner, ignore it
  -> while streaming is active, defer disruptive subtree upgrades and badge/enhancer mounts
  -> text-reveal continues indexing the same subtree shape
  -> after terminal completion, allow one final markdown settle and one pass of deferred enhancers
```

## Implementation Units

- [ ] **Unit 1: Characterize the bad streaming transitions**

**Goal:** Reproduce the reported flicker, pause, abrupt-block, and remount symptoms with narrow regression tests before changing code.

**Requirements:** R1, R2, R3, R5

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal-markdown-integration.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Maybe modify: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/typewriter-reveal-controller.vitest.ts`

**Approach:**
- First reproduce the renderer-boundary bug with `markdown-text` and reveal integration tests: out-of-order async markdown completion, delayed `repoContext`, and background rendering while streamed text continues to grow.
- Add a characterization test for transient streaming-state drops only if the renderer-boundary tests indicate that a false transition could trigger a premature settle.
- Add `assistant-message` characterization specifically for index-key remount risk and mixed-content group-boundary shifts, because this is an already observed code-level remount seam, not a speculative rewrite target.

**Execution note:** Add failing characterization coverage first and verify it fails before implementing any fix.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal.vitest.ts`
- `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal-markdown-integration.vitest.ts`
- `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`

**Test scenarios:**
- Happy path: newer streamed text remains visible while a previous async markdown request is still pending.
- Integration: an older async markdown completion arriving after a newer chunk does not replace the visible content.
- Integration: a late `repoContext` arrival does not let an older render context overwrite the currently visible text.
- Integration: while `isStreaming` remains true, the visible subtree does not jump from incremental output to a full block unexpectedly.
- Edge case: an index-keyed group-boundary shift remounts the active text block on current code, or is proven not to do so.
- Edge case: if a transient `isStreaming` drop is reproducible, it causes a premature final settle on current code and becomes a guarded regression case.
- Error path: async markdown failure during streaming leaves the already visible streamed content intact.

**Verification:**
- At least one new test fails on current code in a way that mirrors the reported symptom class.

- [ ] **Unit 2: Prevent stale async markdown from overwriting newer text**

**Goal:** Ensure only the latest in-scope async markdown result can commit visible output.

**Requirements:** R1, R2, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- Test: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`

**Approach:**
- Add a request-version or full request-identity guard around async markdown completion.
- Scope the guard to the current component owner so late completions after teardown or owner replacement are ignored.
- Keep the currently visible content until the latest valid result resolves.
- Preserve existing sync-first behavior for non-streaming content.

**Execution note:** Start with the failing stale-completion test from Unit 1 and keep the change localized to the markdown component.

**Patterns to follow:**
- Existing `markdown-text.svelte.vitest.ts` coverage for keeping previous async HTML visible while a newer large render is pending.
- Repo preference for stable identity over subtree replacement.

**Test scenarios:**
- Happy path: the latest async markdown result becomes visible when it resolves.
- Edge case: an older async result that resolves after newer text or later `repoContext` has arrived is ignored.
- Edge case: multiple large chunks in sequence still converge on the newest valid content.
- Edge case: a completion that resolves after unmount, rebind, or owner replacement does not commit visible content.
- Integration: concurrent message instances do not cross-contaminate cached or async results.
- Error path: a failed async render does not blank or roll back already visible content.

**Verification:**
- No stale async completion can replace newer streamed content in component tests.

- [ ] **Unit 3: Keep the typewriter subtree stable while streaming**

**Goal:** Remove mid-stream subtree swaps that invalidate the reveal controller’s indexed text-node model.

**Requirements:** R1, R3, R4, R5

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/typewriter-text.svelte`
- Maybe modify: `packages/desktop/src/lib/acp/components/messages/logic/typewriter-reveal-controller.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal-markdown-integration.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/typewriter-reveal-controller.vitest.ts`

**Approach:**
- Make `MarkdownText` use `isStreaming` intentionally to avoid disruptive representation changes while the reveal controller is active.
- Preserve one stable DOM mode during streaming rather than switching between loading/plain/HTML representations mid-stream.
- Defer post-render subtree mutators such as file badge and GitHub badge mounting while the active message is still streaming, unless a specific mutator is proven to preserve reveal indexing.
- Allow the final markdown representation to settle once when streaming reaches a terminal state, so final formatting still appears correctly.

**Execution note:** Keep this change minimal and avoid introducing new effect-driven render loops.

**Technical design:** *(directional guidance, not implementation specification)*
- For an actively streaming message, keep the user on the currently visible incremental subtree.
- Do not switch that subtree into a new top-level render mode while streaming remains active.
- Permit one final transition after terminal completion: stable incremental subtree -> final formatted subtree.
- Run deferred badge/enhancer mounts only after that final settle, or prove in tests that a narrower mount path does not perturb reveal indexing.

**Patterns to follow:**
- Stable state ownership guidance from `docs/agent-guides/svelte.md`
- Existing reveal integration tests that assert block-level hide/show behavior against real markdown output

**Test scenarios:**
- Happy path: text continues to reveal progressively across chunk arrivals with no subtree reset.
- Integration: async markdown completion during streaming does not restart the reveal or jump directly to a full block.
- Integration: when `isStreaming` becomes false, the final rendered markdown settles exactly once into the complete formatted output.
- Edge case: one representative structurally incomplete markdown case, such as an unfinished code fence or list, remains visually stable until final settle.
- Edge case: deferred badge/enhancer mounts do not perturb the reveal subtree while streaming is active.
- Edge case: container rebinding does not create duplicate reveal controllers or orphaned reveal state.

**Verification:**
- Streaming output remains incremental and visually stable in integration coverage, and final formatting still appears after streaming ends.

- [ ] **Unit 4: Re-evaluate streaming ownership across grouped assistant content**

**Goal:** Confirm whether the current last-text-group streaming rule or index-keyed group rendering contributes materially to stop-start behavior in mixed-content messages.

**Requirements:** R1, R3, R5

**Dependencies:** Unit 3

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- Maybe modify: `packages/desktop/src/lib/acp/logic/assistant-chunk-grouper.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Maybe test: `packages/desktop/src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts`

**Approach:**
- Use the characterization tests to decide whether group-boundary changes still cause visible interruptions after Units 2 and 3.
- If needed, make the smallest possible change to keep streaming ownership on the correct visible text region and remove remount-causing key instability.
- Avoid a broad regrouping rewrite unless the tests prove the current grouping contract is itself incorrect.

**Execution note:** Only implement this unit if the renderer-boundary fix does not fully resolve the reported behavior.

**Patterns to follow:**
- Preserve the existing separation between chunk aggregation, grouping, and rendering.
- Favor minimal changes over a new grouping abstraction.

**Test scenarios:**
- Happy path: a text-only message continues streaming in one stable text region.
- Edge case: inserting a non-text block after a text chunk does not prematurely stop visible typing.
- Edge case: index-keyed group changes do not remount already visible streamed text after the fix.
- Integration: thought block and message block transitions do not cause duplicate or restarted typewriter behavior.

**Verification:**
- Mixed-content streaming remains attached to the intended text region with no stop-start regression.

- [ ] **Unit 5: Verify the fix across the touched layers**

**Goal:** Confirm the final fix passes targeted regression coverage and repo-required type checks.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** Units 1-3, and Unit 4 only if needed

**Files:**
- Test: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal-markdown-integration.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/typewriter-reveal-controller.vitest.ts`
- Check: `packages/desktop`

**Approach:**
- Run the smallest relevant test set first.
- Run `bun run check` because the change touches TypeScript/Svelte files.
- If Unit 4 lands, run the smallest additional grouping/store test that covers the altered contract.

**Patterns to follow:**
- Repo guidance to prefer scoped tests over full-suite runs.

**Test scenarios:**
- Happy path: the new regression tests pass for the fixed path.
- Integration: no existing targeted typewriter/markdown integration tests regress.
- Edge case: final render after stream completion still includes full markdown structure.

**Verification:**
- All targeted tests pass.
- `bun run check` passes in `packages/desktop`.

## System-Wide Impact

- **Interaction graph:** The main interaction seam is assistant chunk grouping -> `assistant-message.svelte` -> `MarkdownText` -> `createTextReveal()`. The fix should preserve that layering.
- **Error propagation:** Async markdown failures should remain non-fatal and must not clear or regress already visible streamed content.
- **State lifecycle risks:** The main lifecycle risk is partial or stale async output replacing newer state. The second lifecycle risk is remounting or rebinding the reveal controller while streaming is still active. The third lifecycle risk is a transient `isStreaming` drop triggering a premature final-settle path.
- **API surface parity:** The fix should not change unrelated markdown consumers such as file previews or PR rendering unless the shared markdown renderer adapter itself must be tightened.
- **Integration coverage:** Unit tests alone are not enough. The plan requires cross-layer tests that combine streaming text growth, markdown rendering, reveal behavior, and post-render subtree mutation.

## Risks & Dependencies

- The smallest fix may remove stale overwrites but still leave visible jumps if DOM-mode switching continues mid-stream.
- Delaying markdown upgrades during streaming could affect when formatting appears; tests must prove that final formatting still settles correctly when streaming ends.
- If message-group ownership changes are needed, there is a risk of altering thought/message boundary behavior. That is why the plan defers such changes until after renderer-boundary fixes are validated.
- If `isStreaming` is not stable at the message level, a renderer-only fix may still allow premature final settles unless the component treats terminal completion more defensively.

## Documentation / Operational Notes

- No user-facing documentation changes are expected.
- If the final fix reveals a recurring streaming/rendering rule that is not already documented, add a short note to `AGENTS.md` or the relevant Svelte/streaming guide after implementation rather than during the fix itself.

## Sources & References

- Related code:
  - `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
  - `packages/desktop/src/lib/acp/components/messages/typewriter-text.svelte`
  - `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
  - `packages/desktop/src/lib/acp/components/messages/logic/text-reveal.ts`
  - `packages/desktop/src/lib/acp/components/messages/logic/text-reveal-model.ts`
- Related tests:
  - `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`
  - `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal.vitest.ts`
  - `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal-markdown-integration.vitest.ts`
  - `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Repo guidance:
  - `AGENTS.md`
  - `docs/agent-guides/svelte.md`

---
title: "refactor: Replace allow-list field-rebuild in applySceneTextLimits with shape-preserving truncation"
type: refactor
status: active
date: 2026-05-01
---

# refactor: Replace allow-list field-rebuild in applySceneTextLimits with shape-preserving truncation

## Overview

`applySceneTextLimits` in `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts` is a shape-preserving transformer (`AgentToolEntry → AgentToolEntry`) whose only legitimate job is to truncate five free-form text fields to fixed character limits. It is currently implemented as a manual allow-list rebuild — every field of `AgentToolEntry` has its own `if (entry.X !== undefined) limited.X = entry.X` line. Adding a new field to `AgentToolEntry` and forgetting to add a matching pass-through line silently drops that field on the way to the scene model, with no test or type error. This regression class already shipped once (`editDiffs`, fixed in commit immediately preceding this plan) and will recur until the structural footgun is removed.

The refactor reshapes the function so pass-through is the default and only the five truncation targets are explicit, and updates the `no-spread` coding convention with a narrow, justified carve-out for shape-preserving transformers.

## Problem Frame

Acepe's TypeScript convention forbids spread syntax (`...obj`) to preserve property provenance. The rationale in `.agent-guides/typescript.md`: spread "obscures data flow, makes refactoring error-prone, and breaks TypeScript's ability to track property provenance."

That rationale holds when spread is used to merge heterogeneous values, build new shapes, or accumulate in loops. It does **not** hold when a function takes `T` and returns `T` and intentionally preserves every field except for a small explicit set of transformations. In that case the input type *is* the provenance contract, and TypeScript fully tracks it.

`applySceneTextLimits` is exactly such a function. The convention pushed it into a manual allow-list, which inverted its safety profile: instead of "by default fields pass through, except these five are truncated," it became "these five are truncated and these ~25 others happen to be allow-listed and any future field is silently dropped." This is the opposite of what the rule is trying to protect.

## Requirements Trace

- **R1.** `applySceneTextLimits` must truncate `detailsText`, `stdout`, `stderr`, `resultText`, and `taskResultText` to their declared limits (current behavior preserved).
- **R2.** `applySceneTextLimits` must pass every other `AgentToolEntry` field through unchanged, including any field added to `AgentToolEntry` in the future, without requiring manual addition to a pass-through list.
- **R3.** `taskChildren` must continue to recurse: nested `tool_call` children get truncated; nested non-tool children pass through.
- **R4.** Adding a new field to `AgentToolEntry` must not silently drop in scene materialization. Primary protection is structural (the function itself preserves shape by spread). The regression test in Unit 2 is a *reversion catch* — it fails if someone reverts to allow-list rebuild for fields known at test-write time — but it does *not* automatically protect against future-added fields the test does not yet know about. Future-field protection comes from the structural change, not the test.
- **R5.** The TypeScript style guide must explicitly permit spread (or an equivalent explicit clone) for shape-preserving transformers `(x: T): T` so the next implementer does not re-introduce the allow-list pattern under convention pressure.
- **R6.** Existing test `bounds display output before values enter scene DTOs` and the recently added `preserves editDiffs through scene text limit filtering for edit tool calls` must continue to pass.
- **R7.** No behavioral change in the running app: live edit cards, execute cards, search cards, task children all render identically before and after.

## Scope Boundaries

**In scope:**
- `applySceneTextLimits` and its recursive `taskChildren` traversal in `agent-panel-graph-materializer.ts`.
- A regression test that catches future field-drop bugs.
- Documentation update to `.agent-guides/typescript.md` (the canonical guide referenced from `CLAUDE.md` and `AGENTS.md`).

**Explicit non-goals:**
- Refactoring `compactAgentToolEntry` / `compactToolEntry` in `tool-definition-registry.ts` — those are intentionally narrow projections (`AgentToolEntry → CompactToolDisplay`, different output type). Different shape, different concern.
- Refactoring `operationSnapshotToToolCall` or other field-by-field constructors that build a *new* shape from a *different* shape. They are not shape-preserving.
- Auditing the rest of the codebase for other no-spread-induced footguns. If they exist, they are separate work.
- Changing truncation limits or the `truncateDisplayText` function.
- Loosening the no-spread rule in general — only adding a specific, named carve-out.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts:269` — `applySceneTextLimits`, the function being refactored.
- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts:30` — `AGENT_PANEL_SCENE_TEXT_LIMITS`, the five-field limit table that defines the function's actual responsibility.
- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts:75` — `truncateDisplayText`, the per-field truncator. Already shape-preserving (`string | null | undefined → string | null | undefined`).
- `packages/ui/src/components/agent-panel/types.ts:81` — `AgentToolEntry` type definition. The "source of truth" for which fields exist.
- `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts` — existing test suite covering this function, including the regression test added when fixing the `editDiffs` drop.

### Institutional Learnings

- Today's debugging confirmed the failure mode: missing `editDiffs` in the allow-list silently broke edit-diff rendering across all providers. See conversation context for the diagnosis trace. (No `docs/solutions/` entry exists for this yet — Phase 6 includes writing one as part of `/ce:compound`.)

### External References

None required. Refactor is self-contained and grounded in repo convention plus the empirical bug class observed today.

## Key Technical Decisions

- **Use shape-preserving spread (`return { ...entry, detailsText: ... }`) and add a narrow convention carve-out, rather than a type-level pass-through enforcement.** Spread on `(x: T): T` is provenance-safe because TS uses `T` as the contract — every field is named in the type. Type-level alternatives (e.g., `Required<AgentToolEntry>` with explicit destructuring) require all fields to be present on the input, which `AgentToolEntry` is not (most fields are optional). Branded compile-time enforcement adds machinery without protecting against the actual failure mode (a *new* field being added to the type).
- **Express truncation as a per-field map, not a manual rebuild.** The five truncation targets become a small, explicit list. Anything not in that list is by definition pass-through — there is no second list to keep in sync.
- **Keep `taskChildren` recursion explicit.** It is the only field with structural transformation (recurse on `tool_call` children). It stays as an explicit override after the spread.
- **Update the style guide once, with a concrete example, rather than making this a one-off exception.** Other shape-preserving transformers may exist or be written in the future; the carve-out should be discoverable by the next implementer.

## Open Questions

### Resolved During Planning

- **Should the carve-out be specific to "shape-preserving transformers" or more general?** Resolved: keep it narrow to `(x: T): T` transformers. Broader exceptions risk re-introducing the provenance-loss problem the rule was designed to prevent.
- **Should `taskChildren` recursion be inlined or extracted?** Resolved: keep inline. It is the only structural transformation and extracting it would be over-abstraction for one call site.
- **Is a runtime regression test enough, or should we add a type-level guard?** Resolved: runtime test plus the structural change is enough. The structural change makes the failure mode disappear (you can't forget to allow-list a field that doesn't have an allow-list). The test exists as belt-and-suspenders for the truncation behavior.

### Deferred to Implementation

- The exact wording of the style guide carve-out — should be drafted as a small explicit example in the implementing PR, not pre-written here.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Before** (allow-list footgun, ~70 LOC):

```
applySceneTextLimits(entry):
    limited = { id, type, title, status }       # required base
    if entry.kind: limited.kind = entry.kind
    if entry.subtitle: limited.subtitle = entry.subtitle
    if entry.detailsText: limited.detailsText = truncate(entry.detailsText, ...)
    if entry.scriptText: limited.scriptText = entry.scriptText
    if entry.filePath: limited.filePath = entry.filePath
    ... ~25 more passthroughs ...               # ← every new field needs a line here
    if entry.taskChildren: limited.taskChildren = recurse(...)
    return limited
```

**After** (shape-preserving truncation, ~15 LOC):

```
applySceneTextLimits(entry):
    cloned = clone-with-same-shape(entry)       # spread
    cloned.detailsText = truncate(entry.detailsText, LIMITS.details)
    cloned.stdout      = truncate(entry.stdout,      LIMITS.output)
    cloned.stderr      = truncate(entry.stderr,      LIMITS.output)
    cloned.resultText  = truncate(entry.resultText,  LIMITS.result)
    cloned.taskResultText = truncate(entry.taskResultText, LIMITS.result)
    if entry.taskChildren:
        cloned.taskChildren = recurse-on-tool-children(entry.taskChildren)
    return cloned
```

The function's responsibility — truncating five fields — is now visually identical to the function body. Any future `AgentToolEntry` field is preserved by default. The only way to drop a field now is to write code that explicitly drops it, which is not something a refactor can do silently.

## Implementation Units

- [ ] **Unit 1: Replace allow-list rebuild with shape-preserving truncation**

  **Goal:** Reshape `applySceneTextLimits` so pass-through is structural (via clone) and only the five truncation targets are explicit.

  **Requirements:** R1, R2, R3, R7

  **Dependencies:** None.

  **Files:**
  - Modify: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
  - Test: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`

  **Approach:**
  - Replace the body of `applySceneTextLimits` with a clone of `entry` (using object spread, justified by the new style-guide carve-out — see Unit 3) followed by per-field truncation overrides for the five targets in `AGENT_PANEL_SCENE_TEXT_LIMITS`.
  - Preserve `taskChildren` recursion explicitly: walk children, recurse on `type === "tool_call"`, pass non-tool children through. The shape of the recursive override stays the same as today.
  - Verify with a screen-side spot check that the live UI is byte-identical for at least one non-trivial session (edit, execute, search, task).

  **Patterns to follow:**
  - `truncateDisplayText` is already used at five call sites in the function body — keep the same call signatures.
  - `mapToolCallEntry` (`packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts:848`) constructs `AgentToolEntry` field-by-field from a `ToolCall` — that's a different concern (building from a different shape) and stays untouched. See the residual-risk note in Risks & Dependencies for why it's still worth tracking.

  **Test scenarios:**
  - **Happy path:** A `tool_call` entry with `kind: "execute"`, `stdout` longer than `LIMITS.output`, and `command: "bun test"` truncates `stdout` and preserves `command`.
  - **Edge case:** A `tool_call` entry with `stdout` exactly at `LIMITS.output` characters is not truncated (existing behavior of `truncateDisplayText`).
  - **Edge case:** A `tool_call` entry with no truncation-target fields set returns an entry equal to the input (no spurious additions, no spurious removals).
  - **Integration:** A `tool_call` entry with `taskChildren` containing a nested `tool_call` whose `stdout` exceeds the limit produces an entry whose nested child is also truncated.
  - **Integration:** A `tool_call` entry with `taskChildren` containing a non-tool entry (e.g., `assistant` markdown) preserves that child unchanged.

  **Verification:**
  - All existing tests in `agent-panel-graph-materializer.test.ts` pass.
  - `bun run check` clean.
  - Live app shows no rendering regression for any tool kind (edit, execute, search, task, browser, etc.).

- [ ] **Unit 2: Add regression test that fails if a new `AgentToolEntry` field is silently dropped**

  **Goal:** Belt-and-suspenders behavioral catch for a specific reversion class — if someone later reintroduces an allow-list rebuild and forgets a field that exists today, this test fails. Note: this test does *not* protect against future fields added after this test is written (those are protected by the structural change in Unit 1, not by this test).

  **Requirements:** R4, R6

  **Dependencies:** Unit 1.

  **Files:**
  - Modify: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`

  **Approach:**
  - Add a test that builds an `AgentToolEntry` with every currently-defined field populated (including `editDiffs`, `todos`, `lintDiagnostics`, `webSearchLinks`, `searchMatches`, etc.) and asserts the output preserves them all.
  - The test serves as a structural regression catch: if someone later inverts the function back to allow-list rebuild and forgets a field, this test fails.
  - Test name: something like `passes through every populated AgentToolEntry field unchanged except declared truncation targets`.

  **Test scenarios:**
  - **Happy path:** An entry with all currently-defined optional fields populated returns an entry with all of those fields preserved (truncated values for the five truncation targets, identical references for everything else).
  - **Edge case:** An entry with `editDiffs: []` (empty array) preserves the empty array, not `undefined`. (Catches a different class of bug — over-eager nullification.)

  **Verification:**
  - Test passes after Unit 1.
  - Test would fail if `applySceneTextLimits` reverted to the allow-list pattern.

- [ ] **Unit 3: Add shape-preserving-transformer carve-out to TypeScript style guide**

  **Goal:** Make the next implementer aware that `(x: T): T` transformers are exempt from the no-spread rule, with a concrete example pointing to `applySceneTextLimits`.

  **Requirements:** R5

  **Dependencies:** Unit 1 (so the example is real).

  **Files:**
  - Modify: `.agent-guides/typescript.md`
  - Modify: `CLAUDE.md` (the no-spread bullet duplicates the rule verbatim — needs the same carve-out)
  - Modify: `AGENTS.md` (same — duplicates the rule verbatim)

  **Approach:**
  - Under the existing "Explicit Over Implicit" section in `.agent-guides/typescript.md`, add a small carve-out paragraph immediately after the no-spread rule. State the rule unchanged. State the carve-out: spread is permitted in shape-preserving transformers — i.e., functions whose declared input and output share the same TypeScript type — when used to clone before applying explicit per-field overrides. Reference `applySceneTextLimits` as the canonical example.
  - The carve-out wording **must include both**: (a) a positive example showing the allowed shape (`(x: T): T` clone-then-override), and (b) an explicit counterexample showing what is still forbidden (heterogeneous merges, building new shapes, accumulators in loops, applying `Partial<T>` patches via spread).
  - Apply the **same carve-out text** (or a tightened single-line summary linking to the detailed guide) to the no-spread bullets in `CLAUDE.md` and `AGENTS.md`. Both files contain `NEVER use spread syntax (...obj) — explicitly enumerate properties for provenance tracking.` verbatim today; without an update there, agents that read CLAUDE.md/AGENTS.md as their primary context will see a flat NEVER prohibition contradicting the detailed guide.
  - Note: the carve-out criterion is `(x: T): T` where `T` is the declared shape on both sides. It is not "any function whose inputs and outputs happen to overlap." Reviewer is responsible for catching misapplication (e.g., where `T` is a wide interface and the function is actually building a partial new shape).

  **Patterns to follow:**
  - The existing style-guide section uses bullets and concrete examples. Match that voice.

  **Test expectation:** none — documentation change.

  **Verification:**
  - Reading the section as a fresh implementer, it is clear (a) when spread is allowed, (b) why, and (c) what is still forbidden — the latter shown via an explicit counterexample, not just a positive description.
  - `CLAUDE.md` and `AGENTS.md` no longer state a flat NEVER for spread; they reflect the same carve-out (or link to it) so that agents reading those files as primary context see the consistent rule.

## System-Wide Impact

- **Interaction graph:** Only `applySceneTextLimits` and its callers (`materializeOperationEntry` and the recursive `taskChildren` walk) are touched. No callbacks, no observers, no middleware.
- **Error propagation:** Unchanged. The function does not throw; truncation is a pure string operation.
- **State lifecycle risks:** None. Function is pure.
- **API surface parity:** `AgentToolEntry` is exported from `@acepe/ui` and consumed by both desktop and website packages. No type changes — only the implementation of one function in the desktop package changes.
- **Integration coverage:** The new test in Unit 2 covers cross-field preservation. The existing `bounds display output before values enter scene DTOs` test covers truncation correctness. Live-app spot check covers the visual outcome.
- **Unchanged invariants:**
  - `AgentToolEntry` type definition: unchanged.
  - `AGENT_PANEL_SCENE_TEXT_LIMITS` values: unchanged (12000/12000/8000).
  - `truncateDisplayText` function: unchanged.
  - Caller sites of `applySceneTextLimits`: unchanged.
  - The no-spread rule for non-shape-preserving uses: unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The carve-out is misapplied later (someone uses spread for non-shape-preserving merges, citing this exception). | The style-guide wording must be explicit about the limit (`(x: T): T` only) and include a counterexample of what's still forbidden. Code review enforces. |
| `taskChildren` recursion regresses (the one structural override). | Unit 1 test scenarios include both nested-tool-truncation and nested-non-tool-passthrough cases. |
| Some `AgentToolEntry` field is non-cloneable or has a non-obvious mutation contract. | Inspection: all fields are scalars, plain object references, or arrays. Some array fields (`searchMatches`, `webSearchLinks`, `todos`, `lintDiagnostics`, `taskChildren`, `searchFiles`) are mutable (no `readonly` modifier), and `question.options` is a mutable nested array. Shallow spread shares these references. **This is safe today only because the rendering pipeline is read-only after materialization** — nothing downstream mutates the cloned arrays. If that assumption ever changes (e.g., optimistic UI patches mutating in place), this function must move to deep clone. Document the assumption in the function's doc comment so the next implementer sees it. |
| Future `AgentToolEntry` field is added with truncation requirements but not added to `AGENT_PANEL_SCENE_TEXT_LIMITS`. | Out of scope. This refactor protects against the silent-drop class. Truncation requirements for new fields are a different problem caught by review and tests. |
| `mapToolCallEntry` (`desktop-agent-panel-scene.ts:848`) — and similar field-by-field constructors that build `AgentToolEntry` from `ToolCall` — exhibit a *related* footgun: they have a single object literal plus conditional field setters (e.g., `if (kind === "edit") entry.editDiffs = ...`). A new `AgentToolEntry` field requiring `ToolCall`-derived data and added without updating `mapToolCallEntry` is silently `undefined` for every entry. | Tracked as known residual risk. Out of scope here (different shape, different concern), but called out so that the `docs/solutions/` entry produced by the post-implementation `/ce:compound` step covers both this function and `mapToolCallEntry`. Future work could explore a builder/typed-projection pattern that fails to compile when a required mapping is missing. |
| The `(x: T): T` carve-out criterion is satisfied by any function whose declared input and output types match — including cases where `T` is a wide interface and the function is actually performing a non-shape-preserving merge. TypeScript does not enforce "same-shape-intent." | Carve-out wording (Unit 3) must include an explicit counterexample. Code review enforces. If misapplication recurs, escalate to a lint rule rather than weakening the rule further. |

## Documentation / Operational Notes

- Add a `docs/solutions/` entry under `best-practices/` after the work lands, capturing the lesson: "shape-preserving transformers are an exception to the no-spread rule, and allow-list rebuild is a footgun." The bug-class documentation is part of the `/ce:compound` step after `/ce:work`, not this plan.
- No rollout, monitoring, or migration considerations — pure refactor of a pure function.

## Sources & References

- Related fix (preceding commit): the `editDiffs` allow-list omission that surfaced the footgun.
- Related code: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`, `packages/ui/src/components/agent-panel/types.ts`.
- Style guide: `.agent-guides/typescript.md`, `CLAUDE.md`, `AGENTS.md`.

---
status: active
type: refactor
created: 2026-06-11
god_gate: not-required
origin: architecture-review (improve-codebase-architecture, candidate 6)
---

# refactor: Localize the scene-index fast-path contract

## Summary

The scene-entry index fast path (`graph-scene-entry-match.ts`, 911 LOC) decides among ~7 patch strategies by reading module-level `WeakMap` tags written by three *other* files during the same render. Correctness depends on an implicit, unenforced call order in `agent-panel.svelte:687–713`: reorder the `$derived.by` blocks and all fast paths silently fall through to a full rebuild — no error. Replace the WeakMap tagging with a typed `ScenePatch` value that producers *return* and the index *consumes*, turning a hidden distributed contract into a local, type-checked one.

---

## Problem Frame

`createGraphSceneEntryIndexReadModel().applySnapshot` tries 7 strategies in sequence (`applyGraphScenePatch`, `applyDisplayScenePatch`, `applyTokenRevealPatch`, identity check, truncation, splice, stable-prefix append). Each succeeds only if the incoming `sceneEntries` array was tagged by a `WeakMap` in a different module — `markAgentPanelSceneEntryArrayPatch` (graph materializer), the reveal-patch marker (`reveal-scene-patch.js`), the token-reveal marker (`token-reveal-scene-read-model.ts`). The invariant — "materializer runs, then reveal, then token-reveal, *then* the index sees the right tags" — is enforced nowhere. The call site chains `tokenRevealSourceIndexReadModel.applyPatch(...) ?? .applySnapshot(...)` after a specific build order. A caller who reorders gets degraded patch efficiency silently. The real bug surface is the sequencing across four files, not the 911-LOC matcher.

---

## Requirements

- R1. Patch intent crosses module seams as a typed return value (`ScenePatch`), not via module-level `WeakMap` tags on the shared array.
- R2. The index selects its fast path from the `ScenePatch` it is handed — it no longer reads cross-module ambient state.
- R3. A wrong or missing patch is a typed, observable condition (the index can assert/branch on it), not a silent full-rebuild fallthrough.
- R4. Fast-path strategy logic is unit-testable by passing `(prevState, sceneEntries, scenePatch)` directly — no need to reproduce the 3-stage producer call order.
- R5. No behavior change: the same entries render in the same order with the same patch efficiency for the existing call sequence — fenced by characterization tests.

---

## Scope Boundaries

- Not rewriting the patch *strategies* themselves (truncation/splice/append math) — only how the chosen strategy is signaled.
- Not changing the rendered scene output or the transcript-viewport row contract.
- Not touching the Rust canonical side — this is entirely TS read-model wiring.

### Deferred to Follow-Up Work

- Physical relocation of `graph-scene-entry-match.ts` from `components/agent-panel/logic/` to `session-state/` — plan `2026-06-11-014` U3. This plan only replaces the WeakMap carrier with typed `ScenePatch`; the seam move is separate.

---

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/agent-panel/logic/graph-scene-entry-match.ts` (911) — `createGraphSceneEntryIndexReadModel`, `applySnapshot`/`applyAppendPatch`/`applyPatch`/`selectIndex`/`selectEntryById`/`selectEntryIndexById`.
- Taggers (WeakMap writers): `session-state/agent-panel-scene-entry-array-patch.ts` (`markAgentPanelSceneEntryArrayPatch`/`getAgentPanelSceneEntryArrayPatch`), `logic/reveal-scene-patch.ts` (`getRevealScenePatch`), `token-reveal-scene-read-model.ts` (672, `getTokenRevealScenePatch`).
- Implicit call order: `agent-panel.svelte:687–713` (`revealTextProjection.apply` → graph materializer → token-reveal read-model → index `applyPatch ?? applySnapshot`).
- `virtualized-entry-display.ts` (686) — downstream consumer of the index selections.

### Institutional Learnings

- CLAUDE.md Svelte: no `$effect`; computed values via `$derived`. The fix keeps the `$derived` pipeline but makes the data flowing through it explicit instead of ambient.
- CLAUDE.md TypeScript: explicit over implicit; no hidden provenance. A returned typed patch is the provenance-preserving form.

---

## Key Technical Decisions

- **Return, don't tag.** Each producer returns `{ entries, patch }` (or `entries` plus a `ScenePatch` sidecar) instead of tagging the array via a module WeakMap. The index takes the patch as a parameter.
- **One discriminated `ScenePatch` union.** Variants for graph-scene, display-scene, token-reveal, truncation, splice, stable-prefix-append, and `fullRebuild`. The index `switch`es on it.
- **`fullRebuild` is explicit.** The fallthrough becomes a named variant the index receives deliberately — reorderings that would have silently degraded now either pass the right patch or fail a test.

---

## Open Questions

### Resolved During Planning

- Keep the optimization or delete it? Keep — the fast paths are real (deletion test: the index would rebuild every render). Only the *contract carrier* changes. Resolved.

### Deferred to Implementation

- Whether `ScenePatch` is a second return value or a field on a wrapper object — decided when the first producer is migrated.
- Whether the three producer markers can be removed entirely or one is still needed for an out-of-band consumer — confirm via `rg` on each `get*Patch` reader during migration.

---

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
BEFORE:  producer ──writes──▶ module WeakMap(arrayRef → patchTag)
         index ──reads──▶ WeakMap   (must run after producer, unchecked)

AFTER:   producer ──returns──▶ ScenePatch ──param──▶ index.apply(prev, entries, patch)
                                              └ switch(patch.kind) → strategy | fullRebuild
```

---

## Implementation Units

### U1. Characterize current fast-path selection

**Goal:** Fence which strategy fires for representative update sequences before changing the carrier.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Test: `logic/__tests__/graph-scene-entry-match.test.ts` (extend/create)

**Approach:**
- For append, truncation, splice, token-reveal, and identity cases, assert the resulting index selections (and, where observable, that the fast path — not a rebuild — was taken).

**Execution note:** Characterization-first.

**Test scenarios:**
- Happy path: stable-prefix append sequence → append strategy result.
- Edge case: array identity unchanged → identity short-circuit.
- Edge case: truncation / splice produce the expected reindex.

**Verification:** Green on current code; covers each strategy at least once.

---

### U2. Introduce the `ScenePatch` union and index entry point

**Goal:** Add a typed patch the index can consume as a parameter, alongside the existing WeakMap path (parallel, behind the same results).

**Requirements:** R1, R2, R3

**Dependencies:** U1

**Files:**
- Create: `logic/scene-patch.ts` (discriminated union + constructors)
- Modify: `graph-scene-entry-match.ts` (add `apply(prev, entries, patch)` that `switch`es on `ScenePatch`)
- Test: `logic/__tests__/scene-patch.test.ts`

**Approach:**
- Implement the new `apply` by mapping each `ScenePatch` variant to the existing strategy function. Keep the old `applySnapshot` temporarily.

**Test scenarios:**
- Happy path: each `ScenePatch` variant routes to the matching strategy with the same result as U1.
- Error path: `fullRebuild` variant performs the full rebuild deterministically.

**Verification:** New `apply` reproduces U1 results when handed the equivalent patch.

---

### U3. Make producers return `ScenePatch`; migrate the call site

**Goal:** Graph materializer, reveal pipeline, and token-reveal read-model return patches; `agent-panel.svelte` threads them into the index.

**Requirements:** R1, R2, R4, R5

**Dependencies:** U2

**Files:**
- Modify: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/reveal-scene-patch.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/token-reveal-scene-read-model.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (687–713 — pass returned patches instead of relying on WeakMap order)

**Approach:**
- Replace each `mark*Patch` call with a returned `ScenePatch`. The `$derived.by` blocks now pass their patch forward explicitly.

**Test scenarios:**
- Integration: the full reveal→materialize→token-reveal→index sequence yields the same selections as U1.
- Edge case: deliberately reorder two `$derived` producers in a test → a type error or an explicit `fullRebuild`, not a silent wrong-but-rendering result.

**Verification:** Characterization (U1) green via the new path; `bun run check` green.

---

### U4. Remove the WeakMap tagging machinery

**Goal:** Delete the now-dead module-level tag maps and their markers.

**Requirements:** R1

**Dependencies:** U3

**Files:**
- Modify/Delete: `session-state/agent-panel-scene-entry-array-patch.ts` markers, `logic/reveal-scene-patch.ts` markers, token-reveal marker; delete old `applySnapshot` only when all callers use `apply(prev, entries, patch)` (confirm via `rg applySnapshot` before deletion).

**Approach:**
- `rg` each `get*Patch`/`mark*Patch` to confirm zero remaining readers before deleting.

**Test scenarios:**
- Test expectation: none beyond green suites — pure removal once readers are gone.

**Verification:** No `WeakMap`-tag markers remain; suites + `bun run check` green.

---

## System-Wide Impact

- **Interaction graph:** The fast-path contract now lives between producer return types and the index's `apply` parameter — visible to the type checker.
- **State lifecycle risks:** Removes shared mutable module-level state keyed on array identity (a GC-sensitive, order-sensitive coupling).
- **Unchanged invariants:** Rendered scene order, entry identity, and patch efficiency for the existing call order are preserved.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A `get*Patch` reader exists outside the three known producers | `rg` audit in U4 before deletion |
| Threading patches changes `$derived` reactivity timing | Characterization suite fences output; no `$effect` introduced |
| Patch union grows unwieldy | One variant per existing strategy — bounded by the strategies already present |

---

## Sources & References

- Architecture review candidate 6 (verified file sizes + call site 687–713).
- Related code: `graph-scene-entry-match.ts`, `token-reveal-scene-read-model.ts`, `agent-panel.svelte:687`.

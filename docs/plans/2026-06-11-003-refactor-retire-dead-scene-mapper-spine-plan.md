---
status: completed
type: refactor
created: 2026-06-11
god_gate: not-required
origin: architecture-review (improve-codebase-architecture, candidate 7)
---

# refactor: Retire the dead scene-mapper spine

## Summary

`buildDesktopAgentPanelScene()` in `scene/desktop-agent-panel-scene.ts` has zero callers (verified) — the real production path is `createAgentPanelGraphMaterializerReadModel()` in `session-state/agent-panel-graph-materializer.ts` (`agent-panel.svelte:620`). Delete the dead function, keep the re-export barrel that four importers and the scene tests still consume, and update CONTEXT.md so the glossary names the materializer as the real spine. Smallest and safest of the eight candidates.

---

## Problem Frame

CONTEXT.md and the file header describe `buildDesktopAgentPanelScene` as "the scene mapper spine," but nothing in production calls it. A reader (human or agent) following the glossary to "the spine" lands on dead code plus a re-export barrel — not the materializer that actually owns the caching/patch protocol and feeds the agent panel. This is an AI-navigability defect: the documented entry point points at the wrong module. The barrel itself is live (four importers depend on its re-exports), so only the function and its now-unused input type are dead.

---

## Requirements

- R1. `buildDesktopAgentPanelScene` and any symbols used *only* by it are deleted.
- R2. The re-export barrel keeps exactly the exports still imported by the four consumers (`activity-entry-projection`, `permission-bar`, `agent-panel-graph-materializer`, `virtual-session-list`) and the scene tests.
- R3. CONTEXT.md's "scene mapper spine" entry names `agent-panel-graph-materializer.ts` / `createAgentPanelGraphMaterializerReadModel` as the real production spine.
- R4. `bun run check` and the scene test suite stay green; no consumer loses an import.

---

## Scope Boundaries

- Not refactoring the materializer or the scene modules it composes.
- Not removing the barrel file — it is a live re-export hub.
- Not changing any rendered output.

---

## Context & Research

### Relevant Code and Patterns

- Dead: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts:58` `buildDesktopAgentPanelScene` (0 callers — verified by `rg`).
- Possibly-dead-with-it: `BuildDesktopAgentPanelSceneOptions` (and its sibling `Desktop*Input` types) in `scene-input-types.js` — re-exported by the barrel; confirm whether anything *other than* the dead function references them before deleting.
- Live re-exports the barrel must keep: `mapToolCallToSceneEntry`, `mapSessionEntriesToConversationModel`, `mapSessionEntryToConversationEntry`, `mapVirtualizedDisplayEntryToConversationEntry`, `mapSessionStatusToSceneStatus`, `buildDesktopPlanSidebar`, `buildDesktopComposerModel`, `buildModifiedFilesStrip`, `buildPlanHeaderStrip`, `buildDesktop{Error,Install,Pr,Worktree}Card`.
- Real path: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts` `createAgentPanelGraphMaterializerReadModel` (consumed at `agent-panel.svelte:620` as `graphSceneMaterializer`).
- Glossary entry to fix: `CONTEXT.md` → "Model / scene mapper" / "Spine".

### Institutional Learnings

- CLAUDE.md Architecture: code must be AI-navigable — "find the right unit fast." A documented spine that points at dead code violates this directly.

---

## Key Technical Decisions

- **Delete the function, keep the barrel.** The barrel earns its keep as a re-export hub; the function does not.
- **Verify input-type deadness before deleting it.** `BuildDesktopAgentPanelSceneOptions` is exported; only delete it (and the `Desktop*Input` types) if nothing else imports them.
- **Fix the glossary in the same change.** The navigability fix is the point — leaving CONTEXT.md stale would defeat the deletion.

---

## Open Questions

### Resolved During Planning

- Is the barrel removable? No — four importers + tests depend on its re-exports. Keep it. Resolved.

### Deferred to Implementation

- Whether `BuildDesktopAgentPanelSceneOptions` and the `Desktop*Input` types are referenced outside the dead function — confirm via `rg` at execution; delete only the genuinely-orphaned ones.

---

## Implementation Units

### U1. Confirm deadness and delete the function

**Goal:** Remove `buildDesktopAgentPanelScene` and any symbols orphaned by its removal.

**Requirements:** R1, R2, R4

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts` (delete the function + its now-unused imports: `buildDesktopComposerModel` etc. are still re-exported, so keep those export lines; drop only imports used solely by the function body)
- Modify (maybe): `scene/scene-input-types.ts` (delete `BuildDesktopAgentPanelSceneOptions` + `Desktop*Input` only if orphaned)
- Test: existing scene test suite (adjust any test that imported the dead function)

**Approach:**
- `rg buildDesktopAgentPanelScene` and `rg BuildDesktopAgentPanelSceneOptions` across `packages/` to reconfirm zero non-definition references (including tests). Delete the function; re-run; delete orphaned types.

**Execution note:** None — pure deletion guarded by the type checker.

**Test scenarios:**
- Test expectation: none — no behavioral change. Guarded by `bun run check` (no dangling imports) and the existing scene suite staying green.

**Verification:** `bun run check` green; scene tests green; `rg buildDesktopAgentPanelScene` returns nothing.

---

### U2. Re-point the glossary spine

**Goal:** CONTEXT.md names the live materializer as the spine.

**Requirements:** R3

**Dependencies:** U1

**Files:**
- Modify: `CONTEXT.md` (the "Model / scene mapper" + "Spine" entries; the agent-panel MVC narrative)

**Approach:**
- Update the entry to name `agent-panel-graph-materializer.ts` / `createAgentPanelGraphMaterializerReadModel` as the production scene-assembly spine, and note that the `desktop-agent-panel-scene.ts` barrel is a re-export hub for the focused scene modules.

**Test scenarios:**
- Test expectation: none — documentation.

**Verification:** A reader following CONTEXT.md "spine" lands on the materializer; barrel described as a re-export hub.

---

## System-Wide Impact

- **Interaction graph:** None at runtime — the deleted function had no callers.
- **Unchanged invariants:** All live re-exports preserved; agent-panel rendering unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A type assumed orphaned is referenced elsewhere | Re-`rg` before deletion; type checker catches any miss |
| A test imported the dead function for coverage | Adjust/remove that test; it covered an unreachable path |

---

## Sources & References

- Architecture review candidate 7 (verified 0 callers).
- Related code: `scene/desktop-agent-panel-scene.ts:58`; `session-state/agent-panel-graph-materializer.ts`; `agent-panel.svelte:620`.

---
status: completed
type: refactor
created: 2026-06-11
god_gate: not-required
origin: architecture-review (improve-codebase-architecture, candidate 7)
completed: 2026-06-11
---

# refactor: Retire the dead scene-mapper spine

## Summary

**Already landed.** `buildDesktopAgentPanelScene()` was deleted; `desktop-agent-panel-scene.ts` is now a 30-line re-export barrel. Production scene assembly runs through `createAgentPanelGraphMaterializerReadModel()` in `session-state/agent-panel-graph-materializer.ts` (`agent-panel.svelte:620`). CONTEXT.md names the materializer as the spine and the barrel as a re-export hub. No further implementation work — only verification if desired.

---

## Problem Frame (resolved)

CONTEXT.md previously described `buildDesktopAgentPanelScene` as "the scene mapper spine," but nothing in production called it. Readers following the glossary landed on dead code — not the materializer that owns the caching/patch protocol. The navigability defect is fixed: the function is gone, the barrel keeps live re-exports for four importers + scene tests, and the glossary points at the materializer.

---

## Requirements (met)

- R1. `buildDesktopAgentPanelScene` and symbols used only by it — **deleted**.
- R2. Re-export barrel keeps exports consumed by `activity-entry-projection`, `permission-bar`, `agent-panel-graph-materializer`, `virtual-session-list`, and scene tests — **preserved**.
- R3. CONTEXT.md names `agent-panel-graph-materializer.ts` / `createAgentPanelGraphMaterializerReadModel` as the production spine — **updated**.
- R4. `bun run check` and scene tests green — **verified at landing**.

---

## Current State (post-landing)

- `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts` — re-export hub only (no `buildDesktopAgentPanelScene`).
- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts` — production spine.
- `rg buildDesktopAgentPanelScene` across `packages/` — **no matches**.

---

## Verification Checklist (optional)

If re-validating before closing the ticket:

1. `rg buildDesktopAgentPanelScene packages/` → zero matches.
2. `bun run check` in `packages/desktop` → green.
3. `bun test` scene tests (`desktop-agent-panel-scene.test.ts`, `desktop-agent-panel-scene.coverage.test.ts`) → green.
4. CONTEXT.md "Spine" entry names the materializer, not the barrel.

---

## Sources & References

- Architecture review candidate 7.
- Related code: `scene/desktop-agent-panel-scene.ts`; `session-state/agent-panel-graph-materializer.ts`; `agent-panel.svelte:620`.

---
title: "refactor: Remove agent panel state barrel export"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md
---

# Refactor: Remove Agent Panel State Barrel Export

## Overview

`packages/desktop/src/lib/acp/components/agent-panel/index.ts` still exports `AgentPanelState` and `AgentPanelStateManager` with a comment calling it an old anti-pattern kept for backwards compatibility.

The state class remains an internal implementation detail used by `agent-panel.svelte`. The violation is the public barrel export, because it lets other code depend on panel-local mutable state instead of canonical selectors and presentational props.

Target rule:

```text
agent-panel/index.ts exports AgentPanel and public types only
panel-local state is imported directly only by the component that owns it
no AgentPanelStateManager compatibility export
```

## GOD Check

This touches session-shaped UI projection boundaries. The architecture rule is that panel-local state may exist only as local UI implementation detail. It must not be promoted through public barrels as product truth.

## Planning Inventory

Inventory was collected after commit `c36fe85b3`.

- `packages/desktop/src/lib/acp/components/agent-panel/index.ts`
  - Exports `AgentPanelState`.
  - Exports compatibility alias `AgentPanelStateManager`.
  - Comment says this is the old anti-pattern version.
- `packages/desktop/src/lib/acp/components/agent-panel/state/index.ts`
  - Only re-exports `AgentPanelState`.
  - No imports found outside the barrel.
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
  - Legitimately imports `AgentPanelState` directly from the state file.

## Scope Boundaries

- Do not delete `AgentPanelState`; the component still owns it.
- Do not touch unrelated UI/tool-duration files.
- No behavior changes.

## Implementation Units

- [x] **Unit 1: Remove Compatibility Barrel**

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/index.ts`
- Delete: `packages/desktop/src/lib/acp/components/agent-panel/state/index.ts`

**Approach:**
- Keep `AgentPanel` and public input type exports.
- Remove `AgentPanelState` and `AgentPanelStateManager` barrel exports.
- Delete the now-unused state barrel file.

**Execution result:** Removed the public state exports from the agent-panel barrel and deleted the unused state barrel file. The component still imports its internal state directly.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "old anti-pattern|AgentPanelStateManager|export \\{ AgentPanelState \\} from \\\"\\./state" packages/desktop/src/lib/acp/components/agent-panel`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - same `rg` command returns no matches.

Expected result: no public agent-panel state compatibility export remains.

## Current Verification

- Failing guard before implementation:
  - `rg -n "old anti-pattern|AgentPanelStateManager|export \\{ AgentPanelState \\} from \\\"\\./state" packages/desktop/src/lib/acp/components/agent-panel`
  - failed as expected with the compatibility export matches
- TypeScript check:
  - `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for the old anti-pattern export under `packages/desktop/src/lib/acp/components/agent-panel`

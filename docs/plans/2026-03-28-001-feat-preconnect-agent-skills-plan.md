---
title: "feat: Add pre-connection agent skill dropdown source"
type: feat
status: active
date: 2026-03-28
origin: docs/brainstorms/2026-03-28-preconnect-agent-skill-dropdown-requirements.md
deepened: 2026-03-28
---

# Add pre-connection agent skill dropdown source

## Overview

Load each supported agent's on-disk `SKILL.md` definitions during app startup, normalize them into slash-dropdown command entries, and let `AgentInput` use that per-agent cache whenever a panel has a selected agent but no live session commands yet. Keep the existing live-capabilities path unchanged once connected commands are available, and do not merge the two sources.

## Problem Frame

Today the slash dropdown in `AgentInput` is driven only by `sessionHotState.availableCommands`, so panels without live session capabilities have a dead zone where `/` cannot surface agent skills. The origin document requires immediate per-agent skill suggestions before connection, strict agent scoping, startup loading instead of on-demand scans, and no dropdown at all when the selected agent has no usable on-disk skills (see origin: `docs/brainstorms/2026-03-28-preconnect-agent-skill-dropdown-requirements.md`).

## Requirements Trace

- R1. Panels with a selected agent and no connected session capabilities use that agent's on-disk skills as the slash-dropdown source.
- R2. The pre-connection source is scoped to the currently selected agent only.
- R3. Pre-connection dropdown entries come only from parsed on-disk skills; no built-in or fallback slash commands are injected.
- R4. When live session commands become available, the dropdown switches back to the existing connected-session source.
- R5. Live commands and startup-loaded skills are never merged.
- R6. On-disk agent skills load during app startup so the first `/` interaction is warm.
- R7. The parsed data remains accessible to panels that only know `selectedAgentId`.
- R8. If the selected agent has no usable on-disk skills, pre-connection `/` does not open the dropdown.
- R9. Missing folders and parse failures do not block other valid skills for the same agent.

## Scope Boundaries

- No change to how connected sessions receive, store, or render live slash commands.
- No merging of startup-loaded skills with live capabilities.
- No file watching or runtime disk refresh after startup in this change.
- No plugin skills, library skills, or cross-agent skill aggregation in the pre-connection path.
- No change to inline token rendering after a slash command is selected; this work only changes which commands are offered.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/skills/service.rs` already scans per-agent skill directories, skips missing folders, and logs `tracing::warn!` when an individual `SKILL.md` fails to parse while continuing the rest of the agent's skills.
- `packages/desktop/src-tauri/src/skills/commands.rs` currently exposes tree-oriented and per-skill endpoints, but there is no single rich payload for "all agent skills with frontmatter metadata" at startup. The existing `Skill` type already contains the needed fields (`name`, `description`, `folder_name`, `agent_id`), so the clean seam is a new aggregate Rust command rather than overloading `SkillTreeNode`.
- `packages/desktop/src/lib/skills/api/skills-api.ts` and `packages/desktop/src/lib/utils/tauri-client/skills.ts` already provide a typed frontend wrapper for `listTree()`.
- `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts` has a parallel startup metadata phase that is the right place to warm a new skill cache.
- `packages/desktop/src/lib/components/main-app-view.svelte` creates context stores at app root, which is the established pattern for startup-loaded shared UI state.
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` currently derives `effectiveAvailableCommands` from `sessionHotState?.availableCommands ?? []`, so source selection can be isolated there without changing downstream dropdown rendering.
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` owns the live rich-editor slash-trigger parsing/open path, while `packages/desktop/src/lib/acp/components/agent-input/state/agent-input-state.svelte.ts` still owns selection/token insertion and textarea-era helper behavior. The pre-connection empty-state guard therefore belongs in the rich-editor path first, not only in the state class.
- `packages/desktop/src/lib/acp/components/slash-command-dropdown/logic/command-filter.ts` already filters generic `AvailableCommand` entries, which makes normalized skill commands a good fit for reuse.

### Institutional Learnings

- `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md` reinforces a useful startup rule for this change: persist or preload identity-critical data at the earliest shared boundary, then thread it through existing consumers instead of relying on later reconciliation. That applies here to agent skill availability at startup.

### External References

- None. The repo already has direct patterns for startup initialization, context stores, and skill parsing, so local guidance is sufficient.

## Key Technical Decisions

- Add one richer Rust startup endpoint that returns parsed agent skills grouped by `agentId`, built on top of the existing `SkillsService` parsing/discovery flow. `SkillTreeNode` is intentionally tree-shaped for navigation and does not expose enough metadata for correct dropdown commands, so the startup cache should normalize from `Skill` payloads instead.
- Introduce a dedicated startup-loaded frontend store that exposes `AvailableCommand[]` by `agentId`, instead of passing raw `SkillTreeNode[]` into `AgentInput`. The dropdown and selection flow already consume `AvailableCommand`, so normalizing once at load time avoids repeated tree walking inside every input and keeps pre-connection behavior aligned with the existing UI contract.
- Select the slash-command source by availability, not by session existence alone. If live session commands are present, use them exclusively; otherwise, if a selected agent exists, use the preloaded per-agent skill commands. This satisfies R1, R4, and R5 for both "no session yet" and "session exists but capabilities have not arrived" states.
- Canonical slash name contract: use parsed frontmatter `Skill.name` as the command `name` that gets filtered, displayed, and inserted into the inline token (`@[skill:/<name>]`). Treat `folder_name`, `id`, and file path as internal metadata only. This keeps pre-connection insertion aligned with how users already think about invoking named skills such as `/ce:brainstorm`.
- Use parsed frontmatter `Skill.description` as the dropdown description. Do not invent input hints in this feature.
- Suppress pre-connection dropdown opening before render when the chosen preloaded agent command list is empty. This preserves the existing connected-session empty-state behavior while satisfying R8 for pre-connection panels.
- Treat existing Rust `tracing::warn!` logging for per-skill parse failures as sufficient for this iteration. It already makes invalid `SKILL.md` files debuggable without surfacing new UI diagnostics, and it preserves the non-blocking behavior required by R9.
- When the slash source swaps from preloaded skills to live commands while the dropdown is already open, preserve the user's current query text and rerun filtering against the new source, but allow the existing dropdown selection-reset behavior to choose the first matching item for the new list. Do not try to preserve selection index across source changes.

## Open Questions

### Resolved During Planning

- Where should the startup-loaded cache live? In a new app-level context store created in `packages/desktop/src/lib/components/main-app-view.svelte` and initialized from `InitializationManager`, so any panel with only `selectedAgentId` can read it without coupling `AgentInput` to direct Tauri timing.
- Should pre-connection no-skills handling open and immediately close the dropdown? No. Guard the open path so slash dropdown state is not entered when the selected pre-connection source has zero commands.
- What diagnostics should parse failures have? Keep the existing Rust warning in `packages/desktop/src-tauri/src/skills/service.rs`; it already logs agent, folder, and error while continuing other valid skills.

### Deferred to Implementation

- Exact naming of the new store, selector helper, and normalization utilities should follow nearby store naming conventions once the implementer threads them through the app root.
- Whether the preloaded skill commands should sort by folder name or skill name should match the current order emitted by `SkillsService` unless a test reveals a mismatch with existing UX expectations.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
    A[App startup] --> B[InitializationManager loadBasicMetadata]
    B --> C[skillsApi.listAgentSkills]
    C --> D[Normalize Skill payloads to AvailableCommand[] by agentId]
    D --> E[App-level preconnection skill store]
    E --> F[AgentInput source selector]
    G[sessionHotState.availableCommands] --> F
    H[selectedAgentId] --> F
    F -->|live commands available| I[Slash dropdown uses live commands only]
    F -->|no live commands, selected agent cached| J[Slash dropdown uses agent on-disk skills only]
    F -->|preconnection source empty| K[Do not open dropdown]
```

## Implementation Units

- [ ] **Unit 1: Add a startup-loaded per-agent skill command store**

**Goal:** Create a shared frontend cache that loads parsed on-disk skills once at startup and exposes them by `agentId` in the same `AvailableCommand` shape used by the slash dropdown.

**Requirements:** R1, R2, R3, R6, R7, R9

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src/lib/skills/store/preconnection-agent-skills-store.svelte.ts`
- Modify: `packages/desktop/src-tauri/src/skills/commands.rs`
- Modify: `packages/desktop/src-tauri/src/skills/types.rs`
- Modify: `packages/desktop/src/lib/utils/tauri-client/commands.ts`
- Modify: `packages/desktop/src/lib/utils/tauri-client/skills.ts`
- Modify: `packages/desktop/src/lib/skills/api/skills-api.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`
- Test: `packages/desktop/src/lib/skills/store/preconnection-agent-skills-store.test.ts`

**Approach:**
- Add a new Rust command that returns a richer startup payload grouped by agent, backed by `SkillsService::list_skills_for_agent()` across supported agents. A shape such as `{ agentId, skills: Skill[] }[]` is sufficient because it exposes parsed frontmatter metadata without tree-only UI fields.
- Build a new context store that calls that richer startup API, converts each `Skill` into an `AvailableCommand`, and stores a stable `Record<string, AvailableCommand[]>` or equivalent lookup map keyed by `agentId`.
- Keep the normalized payload intentionally narrow: command `name`, `description`, and optional `input` only. Do not preserve plugin sections or raw tree structure because the pre-connection dropdown does not need them.
- Normalize command names from `skill.name`, not `folder_name` or `id`. This is the canonical inserted slash token and visible dropdown label. If two skills normalize to the same command name within one agent, planning/implementation should fail closed in a deterministic way rather than silently emitting duplicate identical commands.
- Thread store creation from `main-app-view.svelte`, following the existing root-context pattern used by ACP stores, then trigger initialization from `InitializationManager` during the parallel metadata phase so the cache is warm before panel interaction.
- On load failure, record an error or loaded state in the store but degrade to an empty per-agent lookup instead of failing app startup.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/agent-store.svelte.ts`
- `packages/desktop/src/lib/acp/store/plan-preference-store.svelte.ts`
- `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`

**Test scenarios:**
- Happy path - a rich grouped-agent response with two agents and multiple skills normalizes into separate command arrays keyed by each `agentId`.
- Happy path - startup initialization calls the new store initialization alongside other metadata loading and does not delay later workspace/session phases when skill loading succeeds.
- Edge case - a skill whose `folder_name` differs from `name` still normalizes to the frontmatter `name` for insertion and display.
- Edge case - duplicate normalized names within one agent are handled deterministically and covered by an explicit test.
- Edge case - an agent node with zero skill children produces an empty command list for that agent rather than leaking commands from another agent.
- Error path - `listTree()` failure leaves the store in a loaded fallback state and does not fail `InitializationManager.initialize()`.
- Integration - `InitializationManager` invokes the store initialization exactly once during startup and still completes its existing initialization sequence.

**Verification:**
- A root-level store exists that any panel can query by `selectedAgentId` without making a fresh Tauri call.
- Startup still completes when skill loading fails, and the cache is populated when the Rust skill tree succeeds.

- [ ] **Unit 2: Select slash-command source between live capabilities and preloaded agent skills**

**Goal:** Make `AgentInput` choose exactly one slash-command source: live session commands when available, otherwise startup-loaded per-agent skills.

**Requirements:** R1, R2, R3, R4, R5, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- Create: `packages/desktop/src/lib/acp/components/agent-input/logic/slash-command-source.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-input/logic/slash-command-source.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-input.test.ts`

**Approach:**
- Extract the source-selection rule into a small pure helper that receives live `availableCommands`, `selectedAgentId`, and the preloaded per-agent cache, then returns the effective command list plus source metadata needed by the input trigger logic.
- Treat non-empty live commands as authoritative whenever present, even if preloaded skills also exist. Do not concatenate arrays.
- Allow preloaded commands to backfill panels that have only `selectedAgentId`, and panels whose session exists but has not yet produced live commands.
- Keep downstream dropdown rendering unchanged by continuing to pass a plain `AvailableCommand[]` into `SlashCommandDropdown`.
- Define the source-swap contract in this helper's consumers: when live commands replace preloaded skills, the open dropdown keeps the current slash query string and refilters against the new list, but selection index resets via existing dropdown behavior.

**Technical design:** *(directional guidance, not implementation specification)*
- Helper returns a small descriptor such as `{ source: "live" | "preconnection" | "none", commands: AvailableCommand[] }` so open/close logic can distinguish an empty pre-connection source from an empty live source without duplicating conditions.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/slash-command-dropdown/logic/command-filter.ts`
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`

**Test scenarios:**
- Happy path - when live commands exist for the active session, the selector returns only those live commands even if cached agent skills also exist.
- Happy path - when live commands are absent and the selected agent has preloaded skills, the selector returns only that agent's preloaded commands.
- Edge case - switching `selectedAgentId` before connection changes the selected pre-connection command list without retaining commands from the previous agent.
- Edge case - panels with no `selectedAgentId` return no pre-connection command source.
- Error path - missing startup cache data yields an empty source instead of throwing from the selector.
- Integration - `AgentInput` passes the selected command list into `SlashCommandDropdown` and uses live commands again as soon as session command updates arrive.

**Verification:**
- `AgentInput` exposes one effective slash-command list at a time, with no merged results.
- Connected sessions continue to show their live commands once those commands exist.

- [ ] **Unit 3: Enforce pre-connection no-skills behavior in slash trigger handling**

**Goal:** Prevent `/` from opening the dropdown when the chosen pre-connection agent has no usable on-disk skills, while preserving normal connected-session behavior.

**Requirements:** R8, R4, R5

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-input/state/__tests__/agent-input-state-triggers.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-input.test.ts`

**Approach:**
- Thread the slash-command source metadata from Unit 2 into the rich-editor trigger/open logic in `agent-input-ui.svelte` so the input can tell whether it is about to open a pre-connection dropdown with zero commands.
- Guard both reactive rich-editor trigger detection (`handleEditorInput`) and any manual slash-open path used by the component so pre-connection empty sources never enter dropdown-open state.
- Update `agent-input-state.svelte.ts` only if shared manual-open behavior still matters for non-rich-editor callers; do not treat that state class as the primary slash-trigger seam for this feature.
- Leave `SlashCommandDropdown` itself generic; the pre-connection suppression rule belongs at the input boundary where source intent is known.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- `packages/desktop/src/lib/acp/components/agent-input/state/__tests__/agent-input-state-triggers.vitest.ts`

**Test scenarios:**
- Happy path - typing `/` with a selected agent that has preloaded skills opens the dropdown and preserves the typed query.
- Edge case - typing `/` with a selected agent whose preloaded command list is empty does not set slash-dropdown open state.
- Edge case - typing `/` while connected to a session with live commands still opens the dropdown even if the preloaded cache is empty.
- Edge case - if the dropdown is already open on preloaded skills and live commands arrive, the query text is preserved, the list refilters to live commands, and selection resets safely to the first matching result.
- Error path - if preloaded skill initialization failed and no live commands exist, slash trigger handling stays closed and does not throw.
- Integration - selecting a pre-connection skill from the dropdown still inserts the same inline command token format used by the existing selection handler.

**Verification:**
- Panels without usable preloaded skills do not flash or render an empty pre-connection slash dropdown.
- Connected-session slash behavior remains unchanged.

- [ ] **Unit 4: Lock in Rust-side parsing guarantees for agent skill loading**

**Goal:** Add regression coverage around the existing Rust skill loader guarantees that this feature depends on: missing directories are empty, invalid skills are skipped, and valid sibling skills still load.

**Requirements:** R6, R8, R9

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/skills/service.rs`
- Modify: `packages/desktop/src-tauri/src/skills/commands.rs`
- Modify: `packages/desktop/src-tauri/src/skills/types.rs`
- Test: `packages/desktop/src-tauri/src/skills/service.rs`
- Reference: `packages/desktop/src-tauri/src/skills/parser.rs`

**Approach:**
- Add focused `#[cfg(test)]` coverage around `list_skills_for_agent()` or the service-level loading seam that the frontend cache relies on.
- Add coverage for the new grouped startup endpoint so frontend normalization receives full `Skill` metadata rather than tree labels only.
- Use temporary agent skill directories with mixtures of valid skill folders, missing `SKILL.md`, and malformed frontmatter to prove the loader's partial-success contract.
- Do not change the Rust behavior unless tests expose a mismatch with the stated requirements.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/skills/parser.rs`
- `packages/desktop/src-tauri/src/skills/plugins.rs`

**Test scenarios:**
- Happy path - an agent directory with multiple valid `SKILL.md` folders returns all parsed skills in stable order.
- Edge case - a missing agent skills directory returns an empty list rather than an error.
- Edge case - a child folder without `SKILL.md` is skipped.
- Error path - one malformed `SKILL.md` logs/skips that skill while a valid sibling skill still loads.
- Integration - the new grouped startup endpoint returns only valid parsed skills for an agent after partial parse failure, with frontmatter `name` and `description` intact.

**Verification:**
- The frontend startup cache can rely on Rust to return best-effort per-agent skill lists without aborting the entire agent.

## System-Wide Impact

- **Interaction graph:** `InitializationManager` gains one more startup metadata task, `main-app-view.svelte` owns a new context store, a richer Rust startup endpoint exposes grouped `Skill` data, and `AgentInput` becomes the boundary that arbitrates between session hot state and startup-loaded skill state.
- **Error propagation:** Rust parsing issues stay logged in `SkillsService`; frontend startup cache load failures degrade to an empty lookup rather than surfacing a fatal initialization error.
- **State lifecycle risks:** The startup cache becomes intentionally stale after launch because file watching is out of scope. The plan must document that a session's later live commands override startup data instead of trying to reconcile freshness.
- **API surface parity:** Pre-connection commands must stay in `AvailableCommand` shape so dropdown filtering, rendering, and token insertion behave the same as live commands.
- **Integration coverage:** The highest-risk integration is the handoff from preloaded skills to live commands during session connection; tests should prove the dropdown source switches cleanly without merging or leaking previous-agent skills.

## Risks & Dependencies

- The main product risk is choosing the wrong switchover condition and accidentally continuing to show startup skills after live commands arrive. Mitigation: isolate source-selection logic in a pure helper with explicit tests for live precedence.
- A secondary risk is emitting the wrong slash token when frontmatter name and folder name diverge. Mitigation: make `skill.name` the explicit canonical command name in the startup normalization contract and cover it with tests.
- Startup performance could regress if the new cache load blocks initialization excessively. Mitigation: keep it in the existing parallel metadata phase and degrade gracefully on failure.
- There is a mild stale-data risk because startup skills are not refreshed after launch. This is accepted by scope and should be called out in the plan and tests.

## Documentation / Operational Notes

- No user-facing docs are required for the first pass.
- If implementation reveals that startup skill loading noticeably affects launch timing, capture benchmark notes or a follow-up solution doc after the change lands.
- If reviewers find the pre-connection/live handoff confusing, add a short code comment near the selector helper rather than scattering UI comments across the dropdown components.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-03-28-preconnect-agent-skill-dropdown-requirements.md`
- Related code: `packages/desktop/src-tauri/src/skills/service.rs`
- Related code: `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`
- Related code: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- Related code: `packages/desktop/src/lib/acp/components/agent-input/state/agent-input-state.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/components/slash-command-dropdown/logic/command-filter.ts`
- Institutional learning: `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`

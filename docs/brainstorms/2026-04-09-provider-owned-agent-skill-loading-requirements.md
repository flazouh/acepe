---
date: 2026-04-09
topic: provider-owned-agent-skill-loading
---

# Provider-Owned Agent Skill Loading

## Problem Frame
Acepe currently loads pre-connection slash entries through a standalone skills subsystem that hardcodes agent IDs and filesystem roots. That violates the agent-agnostic architecture: discovery is owned by a parallel service instead of by the provider that owns the agent's runtime contract. The result is predictable drift: Copilot has no provider-owned loading path, `.agents`-backed skills are invisible unless the shared service knows about them, and adding a new agent requires updating central hardcoded mappings instead of implementing the provider seam once.

For this change, **pre-connection slash entries** is the canonical abstraction. Disk-backed skills are one possible provider-owned source of those entries, but the ownership rule applies to all pre-connection slash entries shown before session capabilities arrive.

This refactor should make each agent provider responsible for declaring or loading its own pre-connection slash entry source, while preserving the existing product behavior that pre-connection slash suggestions are agent-scoped and switch back to live session commands after connect.

## Requirements

**Ownership and Authority**
- R1. Pre-connection slash entry discovery must be owned by the selected agent provider, not by a central hardcoded map of agent IDs to skill directories or command sources.
- R2. A provider that does not implement pre-connection slash entry loading must explicitly return no pre-connection slash entries; the shared layer must not silently invent a filesystem fallback on its behalf, even when compatible files exist on disk.
- R3. Outside provider-owned modules, shared code must not branch on provider identity, maintain provider-specific skill registries, resolve provider-specific skill paths, or decide whether an agent supports pre-connection slash entry loading.
- R4. Adding or enabling pre-connection slash entry loading for an agent must require implementing the provider-owned seam for that agent, not editing a shared switch, registry, or path resolver.
- R5. Pre-connection command-source selection and capability reporting in the frontend must come from provider-owned metadata or provider-owned RPC results, not from shared agent-specific capability switches.

**Pre-Connection Command Behavior**
- R6. When a panel has a selected agent but no connected session capabilities yet, typing `/` must use that selected agent's provider-owned pre-connection slash entries only.
- R7. When live session commands become available, the input must switch back to the existing connected-session command source without merging the two sources.
- R8. If the selected provider exposes no usable pre-connection slash entries, typing `/` before connection must not open the dropdown. A usable entry means at least one valid, displayable pre-connection slash entry remains after provider loading, validation, and shared normalization.

**Filesystem and Skill Source Semantics**
- R9. Providers that source slash entries from disk must own the path resolution rules for those entries, including support for shared layouts such as `.agents` where applicable.
- R10. Invalid or unreadable provider-owned skill files must not block other valid slash entries for the same provider from loading.
- R11. Shared code may normalize provider-owned results into the UI command shape, but it must not decide where an agent's slash entries live, whether an agent supports loading, or which disk layouts a provider should search.
- R12. If provider-owned slash entry loading depends on project context, the shared layer may only supply validated project inputs such as cwd. It must not take back layout or capability authority while doing so.
- R13. Startup caching is allowed only for provider-returned results or for provider-owned global sources that do not require unvalidated project context. Project-scoped discovery may remain on-demand if needed to preserve ownership and validation boundaries.

**Migration and Compatibility**
- R14. Existing pre-connection behavior for the currently participating built-in providers — Claude Code, Cursor, Codex, and OpenCode — must remain available after the ownership refactor.
- R15. Copilot must no longer be excluded merely because the shared skills service lacks a hardcoded `copilot` entry.
- R16. For this change, the migration scope is limited to Claude Code, Cursor, Codex, OpenCode, and Copilot. Provider-specific path strategy outside that set is deferred unless required to preserve existing behavior.
- R17. Any retained shared service may cache, normalize, and aggregate provider-returned slash entries, but it must not infer provider support, branch by provider, resolve agent skill directories, or read agent skill files directly for pre-connection agent loading.
- R18. Existing Skills Manager, library skill, plugin skill, and skill-copy surfaces must either keep working unchanged or receive an explicit migration path before any shared service used by those features is deleted.

## Success Criteria
- Copilot and other providers can surface pre-connection slash entries only by implementing their provider-owned seam, not by being added to a central filesystem map.
- The shared layer no longer hardcodes `~/.claude/skills`, `~/.cursor/skills`, `~/.codex/skills`, or `~/.opencode/skills` as the source of truth for pre-connection agent skills.
- A provider that wants `.agents` support can expose it through its own implementation without requiring a shared Copilot-specific patch.
- Pre-connection `/` behavior remains agent-scoped, hides empty sources, and switches back to live commands after connect.
- If a provider does not implement pre-connection slash entry loading, it returns no pre-connection slash entries even when compatible files exist on disk.
- Shared frontend code no longer hardcodes which agents support remote or provider-owned pre-connection slash loading.

## Scope Boundaries
- No requirement to unify plugin skills, library skills, and provider-owned skills into one new product surface in this change.
- No requirement to redesign the slash dropdown UX beyond preserving existing behavior under the new ownership seam.
- No requirement to add runtime file watching if startup or on-demand provider loading is sufficient.
- No requirement to force every agent to support disk-backed skills; only the ownership contract is mandatory.
- No requirement to migrate plugin or library skill ownership in this change; those may retain their existing subsystem as long as pre-connection agent loading authority moves behind providers.

## Key Decisions
- Provider ownership is the product and architecture requirement: pre-connection slash entry loading belongs beside the agent provider contract, not in a parallel shared service.
- Shared orchestration may remain, but only as a neutral coordinator over provider-owned results. It may not remain the real authority under a different name.
- Copilot should be fixed by conforming to the same provider seam as other agents, not by adding another special case in shared code.
- The older preconnect dropdown requirements remain valid only for inherited user-visible behavior: agent-scoped pre-connection suggestions, no merge with live session commands, hidden dropdown for empty pre-connection sources, and non-blocking invalid-file handling. Their dependency on the Rust `SkillsService` as the authority is superseded by this document.
- For this release, the in-scope provider set is Claude Code, Cursor, Codex, OpenCode, and Copilot.
- Frontend capability routing is part of the ownership seam. A backend-only refactor is insufficient if shared TS still decides which providers can load pre-connection entries.

## Dependencies / Assumptions
- The existing provider abstraction in `packages/desktop/src-tauri/src/acp/provider.rs` is the likely authority boundary for this refactor.
- The existing pre-connection command path in `packages/desktop/src-tauri/src/acp/commands/preconnection_commands.rs` is relevant prior art because it already uses provider-owned behavior for OpenCode.
- The current frontend pre-connection routing in `packages/desktop/src/lib/acp/components/agent-input/logic/preconnection-remote-commands-state.svelte.ts` and related capability constants is part of the problem scope, not just implementation detail.
- The earlier requirements doc `docs/brainstorms/2026-03-28-preconnect-agent-skill-dropdown-requirements.md` should be treated as complementary only for the inherited user-visible behavior listed above, not as an authority for ownership or filesystem resolution.

## Outstanding Questions

### Deferred to Planning
- [Affects R1][Technical] Should provider-owned slash entry loading live directly on `AgentProvider`, on a provider extension trait, or in a closely-related provider-owned adapter layer?
- [Affects R9][Needs research] For the in-scope providers, which ones should source from shared `.agents` versus provider-local directories, and which should expose non-file-backed pre-connection slash entries instead?
- [Affects R17][Technical] Whether the existing `SkillsService` should be deleted entirely, or retained only for library/plugin features while pre-connection agent loading moves behind providers.
- [Affects R13][Technical] Whether startup caching should remain app-owned or whether pre-connection slash entry loading should become fully on-demand per provider.

## Next Steps
-> Create a structured implementation plan in docs/plans/
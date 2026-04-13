---
date: 2026-04-12
topic: worktree-session-setup
---

# Pre-Session Worktree Setup Workflow

## Problem Frame

Acepe's current worktree workflow is split across a footer toggle, a settings page, and the first-send path. That makes an important session-scoping decision feel hidden and mechanical instead of explicit and reviewable. Users should be able to see, before the first send, whether a session will start in a worktree, whether automatic worktrees are enabled globally, and what setup commands will run. At the same time, the workflow must stay fast: this should not block the composer or force a modal gate before a user can start typing.

## Requirements

**Pre-Session Worktree Card**
- R1. When a new agent panel is spawned without an existing session, the panel must show a dedicated pre-session worktree configuration card in the panel body.
- R2. The card must visually follow the same design language as the modified files header: compact, in-panel, and clearly associated with session setup rather than global settings chrome.
- R3. The card must be non-blocking. The composer remains usable immediately; the card configures how the first send behaves.
- R4. The card must let the user choose whether the upcoming session should start in a worktree.
- R5. The card must make the current choice legible before first send, including the difference between “this session will use a worktree” and “this session will start in the project root.”

**Global Auto-Worktree Control**
- R6. The pre-session card must expose the existing global automatic-worktree preference directly in-context.
- R7. This control remains global in scope. Changing it in the card updates the same global default currently managed in settings.
- R8. The card must clearly distinguish the global default from the per-session choice so users can understand whether they are affecting only the current session setup or future default behavior.

**Setup Commands / Start Script Configuration**
- R9. The pre-session card must expose configuration for the project's worktree setup commands inline or through an affordance launched from the card.
- R10. This configuration surface must reuse the existing per-project setup-command model rather than inventing a second storage path.
- R11. Users must be able to review and edit the commands before first send, without leaving the panel flow.
- R12. When a worktree is created for first send, Acepe must continue running the configured setup commands after creation.

**Footer Worktree Control**
- R13. The bottom-left worktree widget in the composer/footer must stop acting as the primary configuration surface for new sessions.
- R14. After this change, the footer widget becomes a lightweight display of the current worktree context for the active session.
- R15. The footer display must still communicate whether the session is currently inside a worktree and which worktree is active, but it must no longer be the place where users decide first-send worktree behavior for a fresh panel.

**Session Creation Behavior**
- R16. If the user chooses to use a worktree for the upcoming session, first send must still create the worktree before session creation so the session starts in the correct cwd.
- R17. If the user chooses not to use a worktree, first send must create the session against the effective project path with no worktree creation step.
- R18. The pre-session card's state must be the source of truth for this first-send decision rather than the old footer toggle state.
- R19. Existing sessions that already have a worktree path must continue to behave normally; this change is about fresh-session setup and the way active worktree context is presented afterward.

**Worktree and Branch Naming**
- R20. New Acepe-created worktrees and branches must stop using purely random names as their primary identity.
- R21. The final worktree/branch name must include:
  - a timestamp,
  - the project name,
  - the session number (`sequenceId`).
- R22. Acepe must determine the next project-scoped session number before worktree creation, using the DB-backed session sequence as the source of truth rather than guessing from UI state.
- R23. Worktree creation must use the final deterministic name up front rather than creating a temporary name and renaming later.
- R24. The final naming scheme must remain filesystem-safe and git-branch-safe for all supported project names.

## Success Criteria

- A user opening a fresh agent panel can immediately see and adjust worktree behavior before first send without opening settings or hunting through footer controls.
- The composer remains usable immediately; the card informs and configures first send rather than blocking it.
- The footer worktree area reads as status/display for the current session instead of a hidden setup workflow.
- First-send worktree creation still works end-to-end, including setup command execution.
- Acepe-created worktrees and branches end up with stable final names that include timestamp, project identity, and session number.
- Existing sessions and existing worktree cleanup/rename flows continue to function after the naming change.

## Scope Boundaries

- No new per-project auto-worktree preference in this change; the automatic-worktree toggle remains global only.
- No modal gate that forces the user to pick worktree vs non-worktree before they can type.
- No redesign of worktree setup command storage beyond reusing/extending the current project-level config.
- No change to the core meaning of setup commands; this is a workflow and presentation change, not a new command execution model.
- No attempt to rename historical worktrees created before this feature ships.

## Key Decisions

- **In-panel over footer-first**: session setup decisions belong in the main panel body where users already assess session context.
- **Non-blocking workflow**: keep the composer immediately available; the card guides first send instead of forcing an up-front gate.
- **Global default stays global**: the “automatic worktree session” control in this flow edits the existing app-wide preference, not a project-specific one.
- **Footer becomes status**: the footer worktree affordance shifts from configuration to current-context display.
- **Final-name-first naming**: allocate the next project sequence from the DB before worktree creation so Acepe can create the final worktree/branch name once, up front.
- **Reuse existing config surfaces**: setup-command editing should build on the current project-level worktree config model rather than forking storage or semantics.

## Dependencies / Assumptions

- The existing worktree setup command configuration (`loadWorktreeConfig` / `saveWorktreeConfig`) is the correct source of truth for project-level worktree setup behavior.
- The DB/repository layer can provide the next project-scoped session number before worktree creation without relying on frontend inference.
- The agent panel already has a valid location for showing setup/status cards before the composer, so the new card can fit the current view model without inventing a second panel mode.

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R9, R13][Needs research] Should the new pre-session card be a new dedicated shared UI component, or should the existing worktree setup card/footer pieces be recomposed into a new support widget family?
- [Affects R4, R18][Technical] What state model should own the pre-session “use worktree for this session” decision once the footer toggle stops being the source of truth?
- [Affects R9, R10][Technical] Should setup-command editing remain a dialog launched from the card, or should command rows be embedded directly into the card itself?
- [Affects R21, R24][Technical] What exact final naming format should Acepe use (ordering, separators, slugging, timestamp precision), and how should collisions be resolved if a rename target already exists?
- [Affects R22, R23][Technical] What backend-owned reservation/allocation step should provide the final session sequence before worktree creation so the final name is stable and race-safe?
- [Affects R14][Needs research] What should the display-only footer show for non-worktree sessions: project-root label, nothing, or an explicit “No worktree” state?

## Next Steps

-> /ce:plan for structured implementation planning

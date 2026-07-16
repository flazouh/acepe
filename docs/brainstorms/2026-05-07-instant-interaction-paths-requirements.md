---
date: 2026-05-07
topic: instant-interaction-paths
---

# Instant Interaction Paths

## Problem Frame

Acepe is a supervision tool for long-running coding agents. Developers need to move between threads, projects, fullscreen views, queues, and review surfaces without feeling blocked by agent startup, provider resume, history replay, or long transcript rendering.

The key product rule: actions that navigate already-known local state should feel instant. Slow provider work may continue in the background, but the app should paint the best known local view right away.

For this brainstorm, "instant" means:

- The user sees useful feedback in the same interaction frame or under about 100ms.
- Already-known content appears without a blocking spinner.
- Slow work is allowed only after the shell and last known content are visible.
- The app preserves scroll position, focus, and input state unless the user clearly asked to reset them.

## Priority Map

| Priority | Path / Action | Why It Matters | Instant Behavior |
|---|---|---|---|
| P0 | Open an existing thread/session from sidebar, queue, kanban, or search | This is the main navigation move. Waiting here makes the product feel broken. | Show the thread shell and cached transcript/scene immediately. Resume/reconnect happens after paint. |
| P0 | Switch from one thread to another while in agent fullscreen/single mode | The user called this out directly. Fullscreen mode is for fast supervision and focus. | Swap visible thread content immediately, keep single-mode chrome stable, then update connection state in place. |
| P0 | Switch focus between already-open agent panels | Users compare agents and jump to urgent work often. | Change focus and visible content immediately without remounting unrelated panels. |
| P0 | Send a message or follow-up in a ready thread | The user needs proof that their input was accepted. | Clear the composer, show the user message, and show pending/running state immediately. Agent response can stream later. |
| P0 | Approve, deny, or answer a permission/question prompt | These prompts block agent progress. Lag here makes Acepe feel unsafe and unreliable. | Button feedback and prompt state update immediately. Backend/provider confirmation can settle after. |
| P0 | Active streaming transcript update at the tail | This is the most visible live-work path. | New text/tool state appears smoothly without freezing older history or losing scroll-follow behavior. |
| P0 | Scroll within the active thread, including long threads | Reading history should never fight the user. | Visible rows load without blank gaps. User scroll intent detaches from auto-follow immediately. |
| P0 | Jump to latest / return to bottom | Common during active work. | Move to the latest visible content immediately and resume follow behavior only when clearly requested. |
| P1 | Enter or exit agent fullscreen/single mode | Fullscreen is a core focus mode, but less frequent than switching inside it. | Layout changes immediately. The focused agent remains stable. |
| P1 | Open a newly created thread shell | Starting work should feel ready, even if the agent still needs setup. | Show composer and selected agent/model state immediately. Worktree or provider setup can show progress in the same shell. |
| P1 | Switch project/workspace context | Important, but usually less rapid than thread-to-thread switching. | Show project shell, known sessions, and last selected thread quickly. Background scans must not block the first view. |
| P1 | Expand/collapse tool calls, todos, questions, or thinking blocks | These are high-frequency review actions inside the transcript. | Toggle visual state immediately using local data. Large details may lazy-load after the row opens. |
| P1 | Open review/diff/file detail from a thread | Reviewability is core to Acepe, but heavy file/diff work can be slower. | Open the detail surface immediately with known summary/context, then load expensive diff/content work. |
| P1 | Switch queue/kanban/session-summary filters | Supervising many agents depends on fast scanning. | Filtered list updates immediately from local summary state. Fresh provider state can arrive later. |
| P1 | Mark session-level actions such as pin, favorite, archive, close, or reconnect | These are common organization moves. | The visible state changes right away, with clear recovery if persistence fails. |
| P2 | Open settings, agent catalog, or model picker | Important, but not usually part of rapid supervision. | UI shell should open quickly; remote validation/catalog refresh can happen later. |
| P2 | Search historical threads | Useful, but users expect search to take some time. | Search input and recent/local results respond immediately; deep search can stream or show progress. |
| P2 | Cold restore of very old or very large sessions | This may need real replay/repair work. | Show the saved shell and last known summary immediately, then show clear progress if full content repair is slow. |
| P2 | Startup restore of all projects/sessions | App startup can do background work, but it must not block current work. | First usable workspace appears quickly. Full indexing/session refresh continues after. |

## Requirements

**P0 Instant Paths**

- R1. Opening an existing thread/session must render the best available local thread content immediately, before provider resume, reconnect, or history replay finishes.
- R2. Switching between threads inside agent fullscreen/single mode must update the visible thread immediately while keeping the fullscreen/single-mode layout stable.
- R3. Switching focus between already-open agent panels must not remount unrelated panels, lose local state, or wait for provider work.
- R4. Sending a message in a ready thread must show the user's message, clear the composer, and update the thread status immediately.
- R5. Permission and question actions must give immediate visual feedback and update local prompt state before backend/provider confirmation settles.
- R6. Active streaming updates must stay smooth at the transcript tail and must not cause full-history rendering, blank rows, or long UI pauses.
- R7. Thread scrolling must stay responsive in long sessions, including user detach from auto-follow and jump-to-latest behavior.

**P1 Near-Instant Paths**

- R8. Entering or exiting agent fullscreen/single mode must be an immediate layout transition driven by the current focused agent.
- R9. Creating a new thread must show the ready shell and composer immediately, even when worktree setup, agent connection, or first-send preparation is still running.
- R10. Switching project/workspace context must show known local project/session state quickly and defer scans or refresh work.
- R11. Expanding transcript details such as tool calls, todos, questions, and thinking blocks must update local UI state immediately.
- R12. Opening review, diff, or file details from a thread must show the destination surface immediately with known context while heavier content loads.
- R13. Queue, kanban, and session-summary filters must update from local summary state without waiting for provider refresh.

**P2 Fast Enough Paths**

- R14. Settings, agent catalog, model picker, historical search, old-session restore, and app startup restore should feel quick, but may show progress if real loading is needed.
- R15. P2 paths must not block P0/P1 paths. Background refresh, indexing, catalog validation, and repair work must stay behind the main supervision loop.

**Cross-Cutting Feel Rules**

- R16. The UI must distinguish local paint from provider readiness. A thread can be visible and useful while connection state still says connecting, warming, repairing, or refreshing.
- R17. Cached or last-known content should be preferred over empty loading states for known sessions.
- R18. Spinners are allowed only for unknown or truly unavailable content. They should not replace content the app already has.
- R19. Local navigation must preserve scroll position, composer draft, expanded rows, and focused panel where that state still applies.
- R20. Slow paths must fail softly: keep the local view visible, show a clear inline problem state, and avoid replacing the whole thread with an error screen unless the thread cannot be identified.
- R21. The product should track simple budgets for instant paths: first useful paint, input acknowledgement, visible-row count, provider-resume time, and long-session switch time.

## Success Criteria

- Opening a known thread shows useful local content in under about 100ms on a normal machine.
- Switching between threads in fullscreen/single mode feels like changing tabs, not like reopening sessions.
- Sending a message, answering a prompt, expanding a row, and jumping to latest all acknowledge the user immediately.
- Long sessions do not show blank transcript holes while scrolling or switching.
- Provider resume, history replay, worktree setup, and session repair can be slow without blocking local navigation.
- The app has measurements or tests that protect the P0 paths from regressions.

## Scope Boundaries

- This brainstorm does not require provider startup, model response, worktree creation, indexing, or deep historical search to become instant.
- This brainstorm does not decide the implementation architecture. Planning should choose the concrete cache, projection, preload, and test strategy.
- This brainstorm does not redesign the visual style of the agent panel, sidebar, queue, kanban, or review surfaces.
- This brainstorm does not require every P2 path to be optimized before P0/P1 paths are fixed.

## Key Decisions

- **Prioritize local navigation over provider readiness:** Users should be able to inspect known work while reconnect is still running.
- **Treat fullscreen thread switching as P0:** Fullscreen is a focus mode, so switching there must feel especially fast.
- **Use cached content before loading states:** Empty states are worse than slightly stale known content when the session identity is known.
- **Separate perceived speed from real backend speed:** Backend work can be slow if the UI paints, responds, and explains background progress clearly.
- **Protect P0 with budgets:** "Feels instant" needs measurable guardrails, otherwise future changes can slowly make the app feel heavy again.

## Dependencies / Assumptions

- Existing session restore, long-session performance, and agent-panel reliability work remains relevant:
  - `docs/brainstorms/2026-04-12-async-session-resume-requirements.md`
  - `docs/brainstorms/2026-04-29-long-session-performance-requirements.md`
  - `docs/brainstorms/2026-05-01-agent-panel-content-reliability-rewrite-requirements.md`
  - `docs/plans/2026-03-31-002-fix-single-mode-agent-fullscreen-state-plan.md`
- Acepe has enough local session state to show at least a shell, title, status, and last-known content for known sessions. Planning must verify exact data availability before implementation.
- The first implementation should focus on P0 paths before broad app-wide polish.

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R3][Technical] Which local projection is the best authority for immediate thread paint: session graph, scene materialization, transcript snapshot, or a smaller cached read model?
- [Affects R1-R2][Technical] What content is always available for a known session before provider resume completes?
- [Affects R2-R3][Technical] Which current single-mode/fullscreen state paths remount or clear panel state during thread switching?
- [Affects R6-R7][Technical] Which long-session render paths still scale with full history during switch, scroll, or active streaming?
- [Affects R21][Technical] What exact budgets should be used in tests for first useful paint, input acknowledgement, and fullscreen thread switch?

## Next Steps

-> Create a structured implementation plan in docs/plans/
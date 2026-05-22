# Fullscreen Session Switch GOD Architecture Requirements

Date: 2026-05-20

## Problem

In fullscreen mode, switching from one open agent session to another can feel slow.
The first repair attempt used local Svelte fixes such as row object caches, callback caches,
first-frame hydration defers, and fullscreen remount changes.

Those fixes are rejected for this problem. They improve symptoms in some cases, but they put
performance policy in UI readers instead of in clear authority layers.

## GOD Verdict

The clean architecture is not to make `SessionItem`, `SessionList`, or `SceneContentViewport`
guess how to avoid work during a session switch.

The clean architecture is:

1. Session open/load is idempotent in one service-owned path.
2. Sidebar session rows are stable projection data, not component-local memo state.
3. Transcript display rows are revision-keyed projection data, not rebuilt because focus changed.
4. Panel mount lifetime is separate from panel visibility.
5. Fullscreen session switching changes only the active visible panel id.

## Authority Surfaces

| Area | Authority surface | Owner | Allowed consumer behavior |
| --- | --- | --- | --- |
| Session lifecycle and hydration | Session open/load service, backed by canonical session state | Rust/session services | Request open/select; do not decide preload locally |
| Transcript order and identity | Canonical transcript and operation graph | Rust provider/history adapters | Project display rows only |
| Transcript display rows | Pure revision-keyed projection | App projection layer | Read stable rows by session id and revision |
| Sidebar session rows | Pure session-list projection | App projection layer | Render stable row models |
| Fullscreen focus and active panel | Transient UI/workspace panel state | `PanelStore` / workspace UI model | Change active visible panel id |
| Local hover, menu open, rename draft | Transient UI | Svelte component | Keep local |
| Button/card rendering | Presentational UI | `packages/ui` | Render props only |

## Rejected Patterns

| Pattern | Why it is rejected |
| --- | --- |
| Component-local row object caches | The component is repairing unstable upstream projection identity. |
| Component-local callback caches | The component is managing render identity instead of receiving stable actions. |
| First-frame empty transcript hydration | It can cause flicker and makes transcript availability time-based. |
| Blank fullscreen placeholder | It creates visible flicker. |
| Caller-level `isPreloaded` checks | Open/load idempotence belongs in the session-open service, not in each caller. |
| Fixing session switch by hiding transcript work in UI | Transcript projection should not rerun because focus changed. |

## Solution Space

| Option | Description | Performance | Determinism | Complexity | GOD fit | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Local Svelte memo caches | Cache row objects and handlers inside session-list components | Medium | Low | Medium | Poor | Reject |
| Mount deferral | Show empty shell, mount transcript later | Medium | Low | Low | Poor | Reject |
| Sidebar-only virtualization | Render only visible session rows | Good for large sidebars | Medium | Medium | Acceptable, incomplete | Use only as a later add-on |
| Stable session-list projection | Produce stable immutable row models outside Svelte components | Great | High | Medium | Good | Keep |
| Revision-keyed transcript projection | Cache display rows by canonical transcript/operation revisions | Excellent | High | Medium/high | Excellent | Keep |
| Keep-alive panel host registry | Keep open agent panels mounted; fullscreen changes visible panel id only | Excellent | High | Medium | Excellent | Keep |
| Idempotent open-session service | One open path decides whether hydration/reconnect is needed | Excellent | High | Medium | Excellent | Required |

## Best Architecture

The best architecture is a deterministic projection pipeline plus a keep-alive panel deck.

```text
Rust canonical session state
        |
        v
Session open/load service
        |
        v
Stable app projections
  - SessionListProjection
  - TranscriptDisplayProjection
        |
        v
Keep-alive PanelDeck
        |
        v
Presentational UI
```

## Desired Hot Path

For switching between already-open fullscreen sessions:

```text
click session row
  -> PanelStore sets focused/visible panel id
  -> PanelDeck changes visible panel
  -> existing AgentPanelHost is shown
  -> no session load
  -> no transcript projection rebuild
  -> no panel remount
  -> no blank frame
```

This should be a UI visibility change, not a session-open operation and not a transcript
materialization operation.

## Concrete Requirements

1. Already-open fullscreen session switch must not call the persisted-session open path.
2. Already-open fullscreen session switch must not remount the target `AgentPanelHost`.
3. Already-open fullscreen session switch must not rebuild transcript display rows.
4. Already-open fullscreen session switch must not rebuild every sidebar session row.
5. Session-list row identity must come from a projection layer, not Svelte component caches.
6. Transcript display identity must come from canonical display ids and revisions, not component timing.
7. Session open must be idempotent in one service-owned path.
8. Fullscreen display must never show an empty placeholder between two already-open sessions.
9. The final implementation must be measured in the running Tauri dev app with Tauri MCP.

## Implementation Direction For A Future Plan

The next implementation plan should replace the local fixes with these units:

1. Add a pure `SessionListProjection` module that returns stable row view models and stable action ids.
2. Add or use a session-open coordinator that makes open/hydrate/reconnect idempotent.
3. Add a revision-keyed transcript display materializer so focus changes do not rebuild rows.
4. Refactor `PanelDeck` so mount lifetime and visibility are separate.
5. Add Tauri MCP performance checks for:
   - open session to open session
   - unopened historical session to open session
   - large transcript session to another large transcript session

## Non-Goals

- Do not solve this with local Svelte equality maps.
- Do not solve this with `setTimeout`, `requestAnimationFrame`, blank shells, or delayed transcript truth.
- Do not add provider-specific UI branches.
- Do not treat browser-only localhost QA as enough for this desktop behavior.


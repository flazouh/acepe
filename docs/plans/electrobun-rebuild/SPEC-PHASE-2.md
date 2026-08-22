---
title: "Phase 2 spec: make the rebuilt app do what Acepe does"
type: spec
status: ready-for-tickets
date: 2026-08-22
---

# Phase 2: from tracer bullet to feature parity

## Problem statement

Acepe's rebuild has a working spine and an app that starts. Opening it produces:

```
undefined is not an object (evaluating 'window.__TAURI_INTERNALS__.invoke')
```

The Svelte UI boots inside Electrobun, then dies on the first call into a bridge that no longer exists. From a user's side of the screen, the rebuilt app cannot open a project, list sessions, run git, use a terminal, or record a voice note. It can send one message through a tracer view.

Phase 1 answered "can this architecture work". Phase 2 answers "does the app work".

## Why the existing backlog does not cover this

The 56 tickets in `docs/plans/electrobun-rebuild/` were written to migrate an architecture. Every ticket touching the command surface — AC-003, AC-007, AC-008, AC-016, AC-019 — is done, and every one was scoped to a deliberate v1 slice: project and session lifecycle, `message.send`, `turn.cancel`. Twelve commands.

Nothing in the backlog extends that to the 230 commands the shipping app uses, and nothing covers the 118 UI components still calling `tauri-command-client.ts`. The backlog is not wrong; it is finished, and it stopped where it meant to.

## Solution

Extend the contract domain by domain, then move the UI behind it. No new architecture. The event store, decider, projector, projections, engine and RPC all stay exactly as they are.

The shape of every domain ticket is identical, which is what makes this parallelisable in a way phase 1 never was:

1. Add that domain's commands to `OrchestrationCommand`.
2. Add its events to `OrchestrationEvent`, one payload schema each.
3. Extend the decider and its invariants.
4. Add or extend a projection, with its own migration and checkpoint.
5. Expose it through the existing three RPC primitives. **No fourth primitive.**
6. Grade it against recorded sidecar traffic.

## User stories

1. As an Acepe user, I want to open a project in the rebuilt app, so that I can see my sessions.
2. As an Acepe user, I want git status, diff and blame in the rebuilt app, so that I can review what an agent changed.
3. As an Acepe user, I want to run a terminal, so that I can work without leaving the app.
4. As an Acepe user, I want my skills and MCP servers available, so that agents behave as they do today.
5. As an Acepe user, I want voice input, so that I keep the one feature with no ported service at all.
6. As an Acepe user, I want checkpoints and revert, so that I can undo an agent's work.
7. As a maintainer, I want each domain graded against recorded traffic, so that "ported" means "behaves the same" rather than "compiles".

## Seams

The seam is already built and must not move: `packages/contracts`. Every domain enters through `OrchestrationCommand` and leaves through a projection read by `ProjectionSnapshotQuery`. The UI never reads SQLite and never gains a fourth RPC primitive.

Testing seam per domain: the record-and-replay harness. A domain is done when its recorded fixture replays green against the TypeScript implementation, not when its unit tests pass.

## Scope, measured

| Domain | Commands | Service ported | Work |
|---|---|---|---|
| git | 41 | yes (AC-035) | contract + projection + expose |
| acp / sessions | 33 | yes (AC-023..028) | extend contract, grade adapters |
| library / projects | 14 | partly | port remainder + expose |
| skills + MCP | 13 | yes (AC-039) | contract + expose |
| voice | 9 | **no** | port ~2,400 Rust lines, then expose |
| checkpoints | 7 | yes (AC-037) | contract + expose |
| terminal | 5 | yes (AC-038) | contract + expose, gated on AC-053 |
| settings and misc | ~108 | partly | audit, then batch by feature |
| **UI migration** | — | — | 118 of 138 components |

## Ordering

1. **Record fixtures first.** Nothing downstream can be graded without them, and five provider adapters are already merged ungraded.
2. **library / projects**, because the app cannot open anything without it. This unblocks every UI story.
3. **git, skills, checkpoints, terminal** in parallel. Services exist; this is contract and exposure work.
4. **voice**, the only domain needing a real port.
5. **settings and misc**, audited and batched by feature rather than ported command by command.
6. **UI migration**, per feature, following its domain.

## Out of scope

- Any change to the event-sourcing core. If a domain seems to need one, that is a signal the domain is modelled wrong.
- Deleting Rust. AC-047 stays blocked until parity is graded, and premature deletion is how the app stops working.
- New features. Parity means parity.

## Definition of done

- The rebuilt app opens a project, lists sessions, sends a message, streams a reply, runs git and a terminal, and records voice, all verified through `electrobun-qa` against the running window.
- Every domain replays green against recorded sidecar traffic.
- No component imports `tauri-command-client.ts`.

---
title: "Feature gap: rebuilt Acepe versus the shipping app"
status: current
date: 2026-08-22
---

# What is left before the rebuild matches today's Acepe

Measured on `main`, not estimated.

## The headline

| | Shipping (Tauri) | Rebuilt (Electrobun) |
|---|---|---|
| Command surface | **230** `#[tauri::command]` | **12** contract commands |
| Backend | 230,952 lines Rust | 26,828 lines TypeScript |
| UI components wired | 138 Svelte components | **20** touch the new store |
| What the window renders | the real app | a tracer-bullet view |
| Provider parity proven | n/a | **0 of 5** graded |

The spine is real and tested: event store, decider, projector, projections, engine, RPC, five provider adapters, git, terminal, checkpoints, skills, history importers, file index. **None of it is reachable from a user-facing app yet.** The Electrobun window opens a tracer view that sends one message; the real Acepe UI still runs on Tauri.

Roughly **5% of the command surface** and **15% of the UI** have crossed over.

## The three gaps, in the order they have to close

### 1. Command surface: 12 of 230

The v1 contract covers project and session lifecycle plus `message.send` and `turn.cancel`. The services behind everything else exist but nothing exposes them.

By domain, from the Rust command registry:

| Domain | Commands | Service ported? | Exposed over RPC? |
|---|---|---|---|
| git | 41 | yes (AC-035) | no |
| acp / sessions | 33 | yes (AC-023..028) | partly |
| library / projects | 14 | partly | no |
| skills | 13 | yes (AC-039) | no |
| voice | 9 | **no** | no |
| checkpoints | 7 | yes (AC-037) | no |
| terminal | 5 | yes (AC-038) | no |
| settings, misc | ~108 | partly | no |

**Voice is the only domain with no ported service at all.** Everything else is built and unreachable.

The work is not "port more Rust" — it is extending `OrchestrationCommand` and the projections, then wiring each domain through `dispatch`/`snapshot`. That is mechanical and parallelises well, unlike the spine.

### 2. UI: 20 of 138 components

`session-store`, the agent panel and the transcript viewport were rebuilt on projections. The other ~118 components still call `tauri-command-client.ts` directly.

This is the largest single body of remaining work, and it is gated on gap 1: a component cannot move until its commands exist in the contract.

### 3. Parity is unproven

Five provider adapters ported, **none graded**. `packages/harness/fixtures` holds one 5-line Claude session and the tracer reference. No recorded traffic exists for Codex, Cursor, Copilot or OpenCode, so nothing shows they behave like the Rust they replace.

## Ordered plan

1. **Record fixtures.** Use the app normally for a day with the record harness attached. Every parity claim afterwards depends on this, and it costs nothing but time. Needs Alex.
2. **Extend the contract by domain**, largest first: git (41), acp (33), library (14), skills (13). One ticket per domain: commands, events, projection, RPC exposure. Fully parallel.
3. **Port voice.** The one domain with no service. 9 commands, ~2,400 Rust lines.
4. **Migrate the UI by feature**, following the contract. ~118 components, gated on step 2, parallelises once unblocked.
5. **Then AC-046 parity burn-down and AC-047 delete Rust.** Not before: deleting Rust while 95% of commands only exist there is how the app stops working.

## Honest scale

The spine took this session. Steps 1 to 4 are larger than the spine, because 230 commands and 138 components is more surface than the event-sourcing core ever was. The difference is that they are mechanical and independently verifiable, where the spine was neither.

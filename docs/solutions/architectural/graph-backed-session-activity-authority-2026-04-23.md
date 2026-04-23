---
title: Graph-backed session activity is the only session-activity authority
date: 2026-04-23
category: architectural
module: desktop ACP session activity
problem_type: architecture
component: assistant
severity: high
tags:
  - session-state
  - activity
  - canonical-authority
  - operations
  - interactions
  - lifecycle
  - restore
  - reconnect
---

# Graph-backed session activity is the only session-activity authority

## Intent

Acepe must answer "what is this session doing now?" from one durable path:

`canonical graph inputs -> graph-backed activity -> SessionStateEnvelope -> SessionStore materialization -> adapters -> UI`

This removes the older split-brain path where desktop code recomposed activity from `runtimeState`, `hotState.status`, current tool pointers, transcript timing, and interaction snapshots.

## Canonical activity contract

The session graph now carries an activity summary derived from:

- lifecycle,
- operations,
- interactions,
- active turn failure.

The contract is allowed to summarize:

- dominant activity kind,
- active operation count,
- active subagent count,
- dominant operation linkage,
- blocking interaction linkage.

## Desktop boundary

Desktop code still has compatibility adapters, but they are output-only:

- `SessionStore.applySessionStateGraph(...)` hydrates graph-backed activity into hot state,
- lifecycle-only envelopes preserve or promote that stored activity instead of inventing a second authority,
- downstream helpers like `live-session-work.ts` render from graph-backed activity when it exists.

That means queue, tab, sidebar, session item, and panel surfaces no longer need to independently decide whether a session is "planning" or "working".

## Practical consequence

This fixes the bug class where the UI could show **"Planning next moves"** while sub-agent or tool work was still active.

It also makes restore/live parity testable:

1. cold-open from a stored graph can render the same activity family as a live session,
2. lifecycle-only updates cannot silently fork a second activity answer,
3. surfaces agree even when no live tool pointer is currently available.

## What still belongs outside activity

Graph-backed activity does **not** replace:

- `OperationStore` as the owner of detailed tool identity,
- interactions as the owner of the actual blocking prompt state,
- lifecycle/actionability as the owner of resume/retry/send policy.

Instead, activity is the canonical session-level summary built from those sources.

## Regression coverage

- `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/live-session-work.test.ts`
- `packages/desktop/src/lib/acp/store/__tests__/tab-bar-utils.test.ts`
- `packages/desktop/src/lib/acp/store/__tests__/tab-bar-store.test.ts`
- `packages/desktop/src/lib/acp/store/queue/__tests__/queue-utils.test.ts`
- `packages/desktop/src/lib/acp/components/queue/__tests__/queue-item-display.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-content.svelte.vitest.ts`

## Related

- `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md`

---
title: "refactor: Remove unused event subscriber lanes"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md
---

# Refactor: Remove Unused Event Subscriber Lanes

## Overview

Frontend session event ingestion currently has one production subscriber:

```text
EventSubscriber
  - acp-session-update      raw diagnostic / legacy event lane
  - acp-session-state       canonical graph envelope lane
```

Inventory found two additional frontend APIs that are not used by production code:

- `createEventListener(...)` in `packages/desktop/src/lib/acp/logic/event-listener.ts`
  - Directly listens to `acp-session-update`.
  - Only referenced by its own tests.
- `SessionDomainEventSubscriber` in `packages/desktop/src/lib/acp/logic/session-domain-event-subscriber.ts`
  - Exposes an additive `acp-session-domain-event` subscriber.
  - Only referenced by its own tests and a public barrel export.
  - Its own comment says it coexists with the legacy update flow during migration.

Target rule:

```text
No unused public frontend subscriber for acp-session-update
No unused public frontend subscriber for acp-session-domain-event
The only production frontend session event subscriber is EventSubscriber
```

## GOD Check

This touches canonical session event boundaries. The cleanup must not change production event behavior. It only removes unused public APIs that could let future code subscribe to non-canonical/additive lanes directly.

## Planning Inventory

Inventory was collected after commit `d5b95a3ff`.

### Real Violation Candidates

- `packages/desktop/src/lib/acp/logic/event-listener.ts`
  - Obsolete direct Tauri listener for `acp-session-update`.
  - No production imports.

- `packages/desktop/src/lib/acp/logic/session-domain-event-subscriber.ts`
  - Unused frontend subscriber for `acp-session-domain-event`.
  - Publicly exported from `packages/desktop/src/lib/acp/logic/index.ts`.
  - No production imports.

- `packages/desktop/src/lib/acp/constants/logger-ids.ts`
  - Contains logger ID used only by the unused domain-event subscriber.

### Legal Or Lower-Risk Findings

- Rust may still emit `acp-session-domain-event` for backend projection/tests. This slice does not change Rust emission.
- `EventSubscriber` remains because `SessionEventService` uses it for the current production path.
- The raw `acp-session-update` lane remains inside `EventSubscriber` as diagnostic/legacy input until a later full Rust/TS migration removes it.

## Scope Boundaries

- No behavior change to `SessionEventService`.
- No Rust event emission changes.
- No changes to unrelated UI/tool-duration files.

## Implementation Units

- [x] **Unit 1: Delete Obsolete Direct Update Listener**

**Files:**
- Delete: `packages/desktop/src/lib/acp/logic/event-listener.ts`
- Delete: `packages/desktop/src/lib/acp/logic/__tests__/event-listener.test.ts`

**Approach:**
- Remove the unused direct `acp-session-update` listener and its test.

**Execution result:** Deleted the obsolete direct event listener and its self-contained test.

- [x] **Unit 2: Delete Unused Domain Event Subscriber API**

**Files:**
- Delete: `packages/desktop/src/lib/acp/logic/session-domain-event-subscriber.ts`
- Delete: `packages/desktop/src/lib/acp/logic/__tests__/session-domain-event-subscriber.test.ts`
- Modify: `packages/desktop/src/lib/acp/logic/index.ts`
- Modify: `packages/desktop/src/lib/acp/constants/logger-ids.ts`

**Approach:**
- Remove the public export.
- Remove the unused logger ID.
- Delete the subscriber and its tests.

**Execution result:** Removed the public domain-event subscriber export, deleted the unused subscriber/test, and removed its logger ID.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "createEventListener|EventListenerConfig|SessionDomainEventSubscriber|parseSessionDomainEventPayload|SESSION_DOMAIN_EVENT_SUBSCRIBER|session-domain-event-subscriber|event-listener" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/event-subscriber.test.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - same `rg` command returns no matches.

Expected result: no unused frontend subscriber APIs remain for direct legacy update or domain-event lanes.

## Current Verification

- Failing guard before implementation:
  - `rg -n "createEventListener|EventListenerConfig|SessionDomainEventSubscriber|parseSessionDomainEventPayload|SESSION_DOMAIN_EVENT_SUBSCRIBER|session-domain-event-subscriber|event-listener" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
  - failed as expected with direct listener, domain-event subscriber, export, logger, and test matches
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/event-subscriber.test.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
  - passed: 70 tests
- TypeScript check:
  - `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for the removed subscriber API terms under `packages/desktop/src/lib/acp`

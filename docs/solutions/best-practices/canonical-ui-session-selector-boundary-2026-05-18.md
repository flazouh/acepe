---
title: Canonical UI session selector boundary
date: 2026-05-18
category: best-practices
module: desktop ACP session projections
problem_type: best_practice
component: assistant
severity: high
applies_when:
  - Updating queue, kanban, tabs, urgency, session item, agent panel, composer, or telemetry UI
  - Adding session lifecycle, sendability, activity, pending-send, or telemetry display state
  - Touching transcript entry writers, legacy preload paths, or provider-specific transcript display paths
tags:
  - canonical-authority
  - session-selectors
  - ui-derivation
  - transcript-order
  - hot-state
  - legacy-boundary
---

# Canonical UI session selector boundary

## Context

Acepe's UI had several places that read broad session-local objects, such as runtime state or hot state, while building visible session surfaces. Some of those reads were harmless at the time, but the API shape was still dangerous: once a component receives a broad object, future code can quietly start using local state as lifecycle, sendability, activity, or error truth.

This matters for transcript bugs too. The bug class that started this work was a provider-specific ordering and identity issue: raw provider message ids can repeat for multiple content blocks, so the product must not treat those raw ids as display identity or tool-call identity. Provider ids are input metadata unless the canonical model explicitly promotes them. Canonical order, display ids, and tool-call links must be fixed before UI projection, not repaired in Svelte components.

## Guidance

UI surfaces should ask for the exact session value they need. They should not receive full `SessionTransientProjection`, full `SessionRuntimeState`, or broad hot-state objects for session semantics. The public `SessionStore.getSessionRuntimeState(...)` facade is deleted; do not recreate it.

Good selector shape:

```ts
const lifecycle = sessionStore.getSessionLifecyclePresentation(sessionId);
const composer = sessionStore.getStoreComposerState(sessionId);
const pendingSend = sessionStore.getSessionPendingSendIntent(sessionId);
const telemetry = sessionStore.getSessionUsageTelemetry(sessionId);
const autonomousBusy = sessionStore.getSessionAutonomousTransitionBusy(sessionId);
```

Bad selector shape:

```ts
const hotState = sessionStore.getHotState(sessionId);
const runtimeState = sessionStore.getSessionRuntimeState(sessionId);
```

The rule is simple:

- Canonical graph projection owns lifecycle, actionability, activity, turn state, failure state, and provider-backed identity.
- Local transient state may support UI timing or optimistic affordances, but only through narrow selectors with clear names.
- Panel-local hot state may keep drafts, browser/sidebar UI, review UI, and pre-session optimistic visuals. It is not session truth.
- Transcript entry writers that create product-visible rows should use canonical names, for example `appendTranscriptEntry(...)`, `replaceTranscriptEntry(...)`, `recordTranscriptToolCallEntry(...)`, and `updateTranscriptToolCallEntry(...)`.
- Legacy/test preload paths may say `legacy` because they are explicitly reading old stored rows. Do not call canonical product writers `Compatibility`; that makes real transcript writes look like temporary shims.

## Why This Matters

This keeps the authority chain easy to reason about:

```text
provider facts/history/live events
  -> provider adapter edge
  -> canonical session graph
  -> session store selectors
  -> presentation-safe UI
```

When UI reads narrow selectors, accidental split truth becomes much harder. A queue row cannot casually treat pending-send as lifecycle. A telemetry chip cannot inspect unrelated hot-state fields. The composer cannot mix canonical sendability with stale local status.

For the duplicate-id transcript bug class, this boundary is also the safety line. If a provider emits one assistant message id for several content blocks, the adapter/history parser must map each content block to canonical entries and tool calls before the UI sees them. The UI should render canonical display entries; it should not decide which raw provider id is "really" the tool id.

## When to Apply

- A UI component needs session status, activity, sendability, pending-send, mode/model, telemetry, or urgency timing.
- A store builds DTOs for queue rows, kanban cards, tabs, session items, or the composer.
- A provider parser or transcript restore path touches raw message ids, content-block ids, tool-call ids, or provider ordering.
- A legacy transcript preload path still exists for stored rows or tests.

## Examples

Queue, kanban, tab, urgency, session item, agent panel, composer, and telemetry chip surfaces should use selector-level reads:

```ts
const presentation = sessionStore.getSessionLifecyclePresentation(sessionId);

return {
	sessionId,
	status: presentation.status,
	isConnected: presentation.isConnected,
	isStreaming: presentation.isStreaming,
};
```

Local-only fields are still allowed, but the selector name must make the ownership clear:

```ts
const hasLocalPendingSend =
	sessionStore.getSessionHasLocalPendingSendIntent(sessionId);
```

Canonical transcript methods should say what they write:

```ts
entryStore.appendTranscriptEntry(...);
entryStore.replaceTranscriptEntry(...);
entryStore.recordTranscriptToolCallEntry(...);
entryStore.updateTranscriptToolCallEntry(...);
```

Legacy preload helpers may use `legacy` in their names:

```ts
entryStore.preloadLegacyEntriesAndBuildIndex(...);
```

Guard scan before finishing selector-boundary work:

```bash
rg -n "getSessionRuntimeState\\(" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'
```

Expected result: no matches. If a UI needs session state, add or reuse a narrow canonical selector instead.

## Related

- `docs/plans/2026-05-18-002-refactor-canonical-ui-session-projections-plan.md`
- `docs/plans/2026-05-18-011-refactor-delete-unused-runtime-state-facade-plan.md`
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md`
- `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md`
- `docs/solutions/best-practices/canonical-session-projection-ui-derivation-2026-05-01.md`
- `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md`

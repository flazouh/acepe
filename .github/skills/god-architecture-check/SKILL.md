---
name: god-architecture-check
description: "Pre-flight gate for any change in Acepe that touches session lifecycle, turn state, activity, capabilities, or any field that overlaps the canonical SessionStateGraph projection. Use BEFORE editing code that reads or writes hot state, lifecycle status, turn state, connection error, active turn failure, current model, current mode, available commands, autonomous mode, or any session-projection-shaped data. Also use when the user says 'GOD', 'pure GOD', 'canonical authority', 'is this canonical', 'check this against GOD', 'fix this dual-system thing', or when planning a migration that involves removing duplicate state. Steers the agent away from dual-system anti-patterns and toward canonical-only authority."
argument-hint: "[optional: file path, change description, or area to audit]"
---

# GOD Architecture Check

**Acepe's canonical SessionStateGraph projection is the SOLE authority for session-shaped state.** This skill exists because partial migration is the disease, and "prefer canonical, fall back to hot state" is partial migration with extra steps.

Run this skill **before** writing code that touches anything in the canonical-overlap surface. Run it again **before** committing.

## The Hard Rule

> If a field exists on the canonical projection (lifecycle, activity, turnState, activeTurnFailure, lastTerminalTurnId, capabilities), it has **exactly one source of truth**: the canonical projection. No reader falls back to hot state. No writer maintains a parallel copy. If canonical is `null`, the session does not exist for that purpose.

If you catch yourself writing `canonical != null ? canonical.X : hotState.X`, you are violating the rule. The fix is upstream — widen canonical, not patch the reader.

## What is canonical?

`CanonicalSessionProjection` (`packages/desktop/src/lib/acp/store/canonical-session-projection.ts`) is the projection of the Rust-owned `SessionStateGraph` into the TypeScript store. It is fed exclusively by the envelope router (`session-state-command-router.ts` → `applyXxx` handlers in `session-store.svelte.ts`) which receives `LiveSessionStateEnvelopeRequest` events emitted by Rust (`runtime_registry::build_live_session_state_envelope`).

The canonical projection currently includes:

- `lifecycle: SessionGraphLifecycle` — status, errorMessage, actionability.canSend, etc.
- `activity: SessionGraphActivity` — kind, activeOperationCount, dominantOperationId, blockingInteractionId
- `turnState: SessionTurnState`
- `activeTurnFailure: ActiveTurnFailure | null`
- `lastTerminalTurnId: string | null`
- `revision: SessionGraphRevision`

It **must** also include (widening in progress):

- `capabilities: SessionGraphCapabilities` — currentModel, currentMode, availableModels, availableModes, availableCommands, autonomousEnabled, configOptions, providerMetadata, modelsDisplay

## What hot state is allowed to keep

`SessionTransientProjection` (`packages/desktop/src/lib/acp/store/types.ts`) may keep ONLY truly local/transient fields:

- `acpSessionId` — provider-issued session id (truly local mapping)
- `autonomousTransition` — UI animation state
- `statusChangedAt` — local timestamp for stable-status display
- `modelPerMode` — local per-mode model preference cache
- `usageTelemetry` — local snapshot (also flows via Telemetry envelope)
- `pendingSendIntent` — local click guard while waiting for canonical acceptance/error
- `localPersistedSessionProbeStatus` — typed pre-canonical persisted-session reattach probe
- `capabilityMutationState` — local mode/model mutation UI progress only

Everything else — `status`, `isConnected`, `turnState`, `activity`, `connectionError`, `activeTurnFailure`, `lastTerminalTurnId`, `currentModel`, `currentMode`, `availableCommands`, `availableModels`, `availableModes`, `modelsDisplay`, `providerMetadata`, `autonomousEnabled`, `configOptions` — is **forbidden** in hot state. It belongs to canonical.

## Pre-Flight Checklist

Run this against your proposed change. If any answer is "yes" without justification, **stop and pivot to widen canonical instead.**

1. **Are you reading `hotState.X` where X is in the canonical-overlap surface?**
   - YES → canonical-only accessor missing. Add it on `SessionStore` (e.g. `getSessionTurnState(id)`) backed by `canonicalProjections.get(id)?.turnState ?? null`. Reader uses the accessor. No fallback to hot state.
   - YES + canonical doesn't have the field yet → widen `CanonicalSessionProjection` and the `applyXxx` handlers first. Then add the accessor. Then change the reader.

2. **Are you writing `updateHotState(id, { status, turnState, isConnected, connectionError, activeTurnFailure, lastTerminalTurnId, currentModel, currentMode, availableCommands, autonomousEnabled, configOptions, ... })`?**
   - YES → forbidden. Delete the write. Authority is the envelope from Rust. If Rust isn't emitting the lifecycle event for your case, fix Rust (add the emit at the Rust call site) — do not patch over it client-side.

3. **Are you adding `canonical != null ? canonical.X : hotState.X` (the "fallback" anti-pattern)?**
   - YES → forbidden. The whole point of canonical is to be the single source. Treat `canonical == null` as "this session doesn't exist for this purpose" and return `null`/empty consistently.

4. **Are you adding a new field to `SessionTransientProjection`?**
    - YES → only allowed if the field is genuinely local/transient (UI animation, local cache, local timestamp, provider-issued local id). If the field describes session lifecycle/activity/capabilities, it belongs on canonical.
    - YES + it clears on canonical lifecycle/activity/capability events → treat it as suspicious by default. The only allowed exceptions are documented local affordances (`pendingSendIntent`, `localPersistedSessionProbeStatus`, `capabilityMutationState`) with narrow writer/clear rules. Do not generalize this pattern.

5. **Are you doing client-side synthesis of a canonical projection (calling `setCanonicalProjection`, `buildSyntheticFailureProjection`, or similar)?**
   - YES → forbidden. Canonical projections are emitted by Rust only. Removed in Round 4.

6. **Are you branching on `agentId === "cursor" | "copilot" | "claude" | ...`?**
   - YES → provider-specific quirks belong in Rust adapters, not the TS UI layer. Acceptable in TS only for user-facing localized error copy when no canonical channel exists yet. Document and budget removal.

7. **Are you importing Tauri/store/desktop runtime APIs from `@acepe/ui`?**
   - YES → forbidden. `packages/ui/` is presentational only. Pass canonical-derived data via props.

## Steering on a Mid-Flight Change

If the user has already started editing in a way that violates GOD:

1. **Stop the surface patch.** Revert any reader-level fallback patches you made.
2. **Identify the missing canonical capability.** Which field is the reader actually trying to read? Is it on canonical? If not, widen canonical.
3. **Plan the wholesale migration.** Not "this one reader." All readers of that field, plus deletion of the dual-write.
4. **Ask the user whether to proceed with the full widening migration or stop.** Surface patches are technical debt that look like progress.

## Output Contract

When invoked, this skill should:

1. Identify the **canonical-overlap surface** in the proposed change.
2. Classify each touched field as `canonical-owned` | `truly-local` | `to-be-widened` | `must-be-deleted`.
3. List **violations** (dual-read, dual-write, client synth, provider branching, UI-package coupling).
4. Recommend **upstream fixes** (widen canonical, add accessor, delete dual-write, push to Rust adapter) — never reader-level patches.
5. If violations exist, **block the work** and instruct: "Plan widening via `/ce:plan` first. Do not implement reader-level patches."
6. If no violations, **clear the work** with a one-line attestation.

## Example

> User: "Let's read autonomousEnabled from hotState in kanban-view."

Skill output:

> **GOD violation.** `autonomousEnabled` is in the canonical-overlap surface (capabilities). Hot state is forbidden as a source.
>
> **Field:** `autonomousEnabled` — `to-be-widened`. Canonical projection does not yet expose `capabilities`. Widening required.
>
> **Required upstream fix:**
> 1. Extend `CanonicalSessionProjection` with `capabilities: SessionGraphCapabilities`.
> 2. Populate `capabilities` in `applyLifecycle` / `applySnapshot` / `applyCapabilities` handlers.
> 3. Add `SessionStore.getSessionAutonomousEnabled(id): boolean | null` reading canonical.
> 4. Reader in kanban-view uses the accessor. Returns `false` when canonical is `null` (session not yet visible).
> 5. Delete the `updateHotState({ autonomousEnabled })` writes (10+ sites). Rust capabilities envelope is the only writer.
> 6. Remove `autonomousEnabled` from `SessionTransientProjection` and `DEFAULT_TRANSIENT_PROJECTION`.
>
> **Block:** do not edit kanban-view directly. Plan the widening via `/ce:plan` first.

## Invocation

Call this skill when:

- About to edit any reader of `hotState.{status,isConnected,turnState,activity,connectionError,activeTurnFailure,lastTerminalTurnId,currentModel,currentMode,availableCommands,autonomousEnabled,configOptions}`.
- About to write `updateHotState({...})` with any of those fields.
- About to add a new field to `SessionTransientProjection`.
- Reviewing a PR that touches `session-store.svelte.ts`, `session-messaging-service.ts`, `session-connection-manager.ts`, `session-event-service.svelte.ts`, `live-session-work.ts`, `urgency-tabs-store.svelte.ts`, `queue/utils.ts`, `canonical-session-projection.ts`, `session-state-command-router.ts`.
- The user mentions "GOD", "canonical", "dual-system", "hot state", "envelope authority", "session lifecycle".
- After Round 4/5 GOD migration work, before any commit that touches the canonical-overlap surface.

## Anti-Patterns to Block (Quick Reference)

```ts
// ❌ FORBIDDEN — dual-read fallback
const turnState = canonical != null
  ? mapCanonicalTurnState(canonical.turnState)
  : hotState.turnState;

// ❌ FORBIDDEN — dual-write
this.hotStateManager.updateHotState(sessionId, {
  status: "streaming",
  turnState: "streaming",
  connectionError: null,
});

// ❌ FORBIDDEN — client-side canonical synth
this.canonicalProjections.set(sessionId, buildSyntheticFailureProjection(...));

// ❌ FORBIDDEN — UI package importing Tauri/store
import { invoke } from "@tauri-apps/api/core"; // inside packages/ui/

// ✅ CORRECT — canonical-only accessor with sensible null behavior
const turnState = sessionStore.getSessionTurnState(sessionId); // null when no canonical
if (turnState === null) {
  return; // session doesn't exist for this purpose
}

// ✅ CORRECT — Rust emits the lifecycle envelope; TS routes it
// (no client write, no client synth)
```

## Hard No

- "Just for now" fallbacks. They become permanent.
- "Pre-canonical sentinel" fallbacks. The canonical projection arrives within ms of session creation. If it doesn't, fix the Rust emit, don't paper over it.
- "Optimistic UI" via lifecycle/capability hot-state writes. `pendingSendIntent` may disable Send immediately, but it must not assert `status`, `turnState`, `isConnected`, model/mode, commands, or any other canonical truth. If Rust is slow, fix Rust.
- "Provider quirk" branching in TS. Push to Rust adapter.

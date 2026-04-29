---
title: Reserved first-send must not route through resume
date: 2026-04-28
category: logic-errors
module: acp-session-graph-authority
problem_type: logic_error
component: assistant
severity: critical
symptoms:
  - Fresh Cursor, Copilot, and ACP sessions created successfully but failed on the first user message
  - First send called resume/load and providers returned session-not-found or reopen errors
  - Planning and tool-call activity disappeared because graph-backed activity was not authoritative at open time
  - Agent panel flickered through disconnected, reconnecting, error, and connected states
root_cause: logic_error
resolution_type: code_fix
related_components:
  - acp-session-lifecycle
  - session-state-graph
  - agent-panel
  - tool-rendering
tags:
  - session-graph
  - first-send
  - reserved-lifecycle
  - detached-lifecycle
  - god-architecture
  - cursor
  - copilot
  - tool-rendering
---

# Reserved first-send must not route through resume

## Problem

After PR 180, newly-created sessions could be synchronously created by Cursor, Copilot, and other ACP providers, but the first user message was routed through `connectSession()` / `acp_resume_session` instead of directly calling `sendPrompt`. Providers interpreted that as a request to load an already-existing saved session, so fresh sessions failed before their first turn could render.

The clean architecture invariant is: a backend-authored `Reserved` session is ready for its first prompt and must use direct send; a backend-authored `Detached` session is restored/cold and may use resume/load.

## Symptoms

- Fresh Cursor sessions produced provider errors like `Session "<id>" not found` immediately after creation.
- Copilot sessions could report transport-level session-not-found/reopen failures even though the Acepe panel looked connected.
- The agent panel appeared, disappeared, and reappeared with a connected state because the UI moved through a reconnect path that should never have run.
- Planning "next move" and tool-call activity were missing or collapsed because projection code was still allowed to derive presentation state from hot/local fallbacks.
- Retry and terminal-turn UI behaved inconsistently because canonical turn states (`"Idle"`, `"Running"`, `"Completed"`, `"Failed"`) were compared directly with legacy hot-state values (`"idle"`, `"streaming"`, `"completed"`, `"error"`).

## What Didn't Work

Treating missing canonical lifecycle as "probably disconnected" was the core mistake:

```ts
// Bad: no canonical lifecycle yet falls through to hot state.
// A just-created Reserved session has no hot connection flag yet,
// so this incorrectly routes first send through connectSession().
const canSend = canonicalCanSend ?? hotState.isConnected;

if (!canSend) {
	return this.connectSession(sessionId).andThen(() => send());
}
```

The same split-authority smell appeared in turn-state checks:

```ts
// Bad: canonical values are PascalCase, hot values are lowercase.
const turnState = canonical != null ? canonical.turnState : hotState.turnState;

if (turnState === "error") {
	// Never true for canonical "Failed".
}
```

These patches would have been narrow and wrong:

- Special-casing Cursor or Copilot session-not-found errors in the resume path.
- Treating `hotState.isConnected` as a safe fallback for created sessions.
- Adding retry spinners without fixing why first send entered the wrong lifecycle lane.
- Synthesizing lifecycle or capability defaults in the desktop store when Rust did not provide them.

## Solution

Make the backend-owned session graph the only lifecycle and capability authority at the session-open boundary.

### Rust open snapshots carry lifecycle and capabilities

`SessionOpenFound` now requires the lifecycle and capability data needed to decide actionability:

```rust
pub struct SessionOpenFound {
    // Existing identity, transcript, operation, and turn fields...

    // Canonical lifecycle/actionability authority.
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
}
```

New synchronously-created sessions are opened as `Reserved`. Cold restored sessions are opened as `Detached`. That distinction is made in Rust, where provider state is known, not guessed in Svelte stores.

### Desktop materialization fails closed when graph authority is missing

`graphFromSessionOpenFound` asserts that the open result has backend graph authority before materializing the snapshot:

```ts
export function graphFromSessionOpenFound(found: SessionOpenFound): SessionStateGraph {
	assertOpenFoundHasGraphAuthority(found);

	return {
		requestedSessionId: found.requestedSessionId,
		canonicalSessionId: found.canonicalSessionId,
		lifecycle: found.lifecycle,
		activity: selectSessionGraphActivity({
			lifecycle: found.lifecycle,
			turnState: found.turnState,
			operations: found.operations,
			interactions: found.interactions,
			activeTurnFailure: found.activeTurnFailure,
		}),
		capabilities: found.capabilities,
		// Other graph fields omitted.
	};
}
```

No desktop code should synthesize a "detached" or "connected" lifecycle for an open snapshot. Missing lifecycle/capabilities is a protocol failure, not a recoverable UI hint.

### First send activates only Reserved created sessions

`canActivateCreatedSessionWithFirstPrompt` encodes the routing invariant directly:

```ts
export function canActivateCreatedSessionWithFirstPrompt(input: {
	readonly session: SessionCold;
	readonly lifecycleStatus: SessionGraphLifecycle["status"] | null;
}): boolean {
	if (!isCreatedSessionWithoutSource(input.session)) {
		return false;
	}

	return input.lifecycleStatus === "reserved";
}

export function isPreCanonicalCreatedSession(input: {
	readonly session: SessionCold;
	readonly lifecycleStatus: SessionGraphLifecycle["status"] | null;
}): boolean {
	return (
		isCreatedSessionWithoutSource(input.session) && input.lifecycleStatus === null
	);
}
```

The store then sends directly for `canSend` or `Reserved` first-send activation, fails closed for a created session with missing lifecycle, and only uses `connectSession()` for non-created/source-backed or `Detached` restore flows:

```ts
const canSend = this.getSessionCanSend(sessionId) ?? false;
const lifecycleStatus = this.getSessionLifecycleStatus(sessionId);
const canActivateFirstPrompt = canActivateCreatedSessionWithFirstPrompt({
	session,
	lifecycleStatus,
});

if (canSend || canActivateFirstPrompt) {
	return send();
}

if (isPreCanonicalCreatedSession({ session, lifecycleStatus })) {
	return errAsync(new ConnectionError(sessionId));
}

return this.connectSession(sessionId).andThen(() => send());
```

### Canonical and hot turn states are mapped at the boundary

Canonical graph state and legacy hot state intentionally use different unions. Keep comparisons in one domain:

```ts
export function mapCanonicalTurnStateToHotTurnState(turnState: SessionTurnState): TurnState {
	switch (turnState) {
		case "Idle":
			return "idle";
		case "Running":
			return "streaming";
		case "Completed":
			return "completed";
		case "Failed":
			return "error";
	}
}
```

Use canonical values only when checking canonical terminality:

```ts
const canonicalTurnIsTerminal =
	canonical?.turnState === "Completed" || canonical?.turnState === "Failed";

if (canonicalTurnIsTerminal) {
	return;
}
```

## Why This Works

The bug was not provider-specific. It was a split-authority bug: desktop hot/local state was allowed to decide lifecycle actionability before the canonical graph had been applied. For a just-created session, that local state looked disconnected, so the send path chose resume/load even though the provider had just returned a live session ready for its first prompt.

Moving lifecycle and capabilities into `SessionOpenFound` restores the GOD architecture boundary:

1. Rust owns provider lifecycle truth at open/create time.
2. `replaceSessionOpenSnapshot` can populate canonical projections before the first user-visible render.
3. `Reserved` and `Detached` become explicit routing states, not inferred UI conditions.
4. Missing graph authority fails closed instead of silently falling back to a lower-authority projection.
5. Planning and tool rendering can stay graph-backed because open snapshots seed canonical activity from the same graph contract.

## Prevention

- Treat `Reserved -> direct send` and `Detached -> resume/load` as a routing contract, not a UI preference.
- Never decide first-send routing from `hotState.isConnected`; hot state is only a pre-canonical sentinel.
- Keep `SessionOpenFound` as the single open/create seed for lifecycle, capabilities, activity, and turn state.
- Add regression tests that assert a created `Reserved` session sends the first prompt without calling `connectSession()`.
- Add fail-closed tests for created sessions with missing canonical lifecycle so future code cannot reintroduce hot-state fallback.
- Map canonical turn states to hot turn states before comparing against legacy UI literals.
- Preserve graph-backed activity before lifecycle-only presentation collapse so planning and tool-call rows remain visible during provider transitions.

## Related Issues

- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` - Defines the intended seven-state lifecycle and the non-authoritative role of transient projections.
- `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md` - Covers provider-owned identity and the creation-time `Reserved` lifecycle window.
- `docs/solutions/architectural/graph-backed-session-activity-authority-2026-04-23.md` - Covers graph-backed planning/tool activity projection.
- `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md` - Covers canonical graph envelope authority and reopen/reconnect state.
- `docs/solutions/logic-errors/terminal-state-guard-missing-blocked-2026-04-25.md` - Related pattern: guard logic missing a protected state allowed lower-authority updates to regress canonical state.

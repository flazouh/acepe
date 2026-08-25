/**
 * Regression coverage for the first-send activation gate.
 *
 * Live repro (2026-08-25, worktree first-message-send): typing the first
 * prompt into a brand-new deferred-creation Claude Code session and pressing
 * Enter dispatched `session.create` but never `message.send`. The panel sat
 * at "Ready to assist" (or, once the connection machinery timed out, showed
 * "Unable to load session ... Failed to connect session").
 *
 * Root cause, traced live via the tracer sqlite event log and the
 * session-state-envelope pipeline:
 *
 * 1. `AgentInputState.sendPreparedMessage`'s pre-session path calls
 *    `createSession()` then immediately `sendMessage()` on the new session id.
 * 2. `createSession()` registers the session in
 *    `SessionCreationCoordinator#pendingCreationSessions` (the "first prompt
 *    is unconditionally allowed" grace window) via `beginPendingCreation`.
 * 3. Concurrently, the backend pushes a `SessionStateEnvelope` for the new
 *    session over the live event channel. Because the session isn't "known"
 *    yet, `SessionEventService.handleSessionStateEnvelope` calls
 *    `materializePendingCreationSession`, which *clears* the pending-creation
 *    grace window (`completePendingCreation`) as a side effect of creating
 *    the local cold session record.
 * 4. For a deferred/orchestration-born session the *first* envelope that
 *    arrives is typically a bare metadata patch ("delta" kind) with no prior
 *    graph-revision baseline. `routeSessionStateEnvelope` can only apply a
 *    "delta" against a known baseline (`hasCurrentGraphRevision`); with none
 *    available it degrades to a `refreshSnapshot` no-op, so canonical
 *    `lifecycleStatus` is never actually set to "reserved" by this envelope.
 * 5. By the time `AgentInputState`'s local `sendMessage()` call reaches
 *    `SessionMessagingOrchestrator.sendMessage`, `hasPendingCreation()` is
 *    already false (cleared in step 3) *and* `lifecycleStatus` is still
 *    `null` (never set in step 4), so `canActivateCreatedSessionWithFirstPrompt`
 *    returns false too. Both gates fail simultaneously and the orchestrator
 *    hard-fails with `ConnectionError` -- `message.send` is never dispatched.
 *
 * Fix: a freshly materialized, source-less "created" session with no
 * canonical lifecycle graph yet (`lifecycleStatus === null`) is, by
 * construction, in the same "hasn't connected yet, first prompt still
 * allowed" state as an explicit "reserved" lifecycle -- the canonical graph
 * simply hasn't caught up. Widen the gate to accept both, rather than
 * resurrecting a second, local-only readiness signal.
 */
import { describe, expect, it } from "vitest";
import type { SessionMetadata } from "../types.js";
import { canActivateCreatedSessionWithFirstPrompt } from "./first-send-activation.js";

function createdSessionMetadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
	const now = new Date();
	return {
		title: "New session",
		createdAt: now,
		updatedAt: now,
		sourcePath: undefined,
		sessionLifecycleState: "created",
		parentId: null,
		...overrides,
	};
}

describe("canActivateCreatedSessionWithFirstPrompt", () => {
	it("activates when the canonical lifecycle already reports reserved", () => {
		expect(
			canActivateCreatedSessionWithFirstPrompt({
				sessionMetadata: createdSessionMetadata(),
				lifecycleStatus: "reserved",
			})
		).toBe(true);
	});

	it("activates when the canonical lifecycle graph has not been established yet (race)", () => {
		// This is the live-repro window: the session's cold record was just
		// materialized locally, but no SessionStateGraph has landed for it yet
		// because the first envelope degraded to a refreshSnapshot no-op.
		expect(
			canActivateCreatedSessionWithFirstPrompt({
				sessionMetadata: createdSessionMetadata(),
				lifecycleStatus: null,
			})
		).toBe(true);
	});

	it("does not activate once the canonical lifecycle reports a real non-reserved status", () => {
		expect(
			canActivateCreatedSessionWithFirstPrompt({
				sessionMetadata: createdSessionMetadata(),
				lifecycleStatus: "failed",
			})
		).toBe(false);
	});

	it("does not activate for a session that already has a source path", () => {
		expect(
			canActivateCreatedSessionWithFirstPrompt({
				sessionMetadata: createdSessionMetadata({ sourcePath: "/some/imported/session.jsonl" }),
				lifecycleStatus: null,
			})
		).toBe(false);
	});

	it("does not activate for a session that is not in the 'created' lifecycle state", () => {
		expect(
			canActivateCreatedSessionWithFirstPrompt({
				sessionMetadata: createdSessionMetadata({ sessionLifecycleState: "persisted" }),
				lifecycleStatus: null,
			})
		).toBe(false);
	});
});

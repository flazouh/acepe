import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionGraphActivity, SessionTurnState } from "../../../services/acp-types.js";
import { AwaitingModelRefreshStore } from "../awaiting-model-refresh-store.svelte.js";
import type { CanonicalSessionProjection } from "../canonical-session-projection.js";

const awaitingModelActivity: SessionGraphActivity = {
	kind: "awaiting_model",
	activeOperationCount: 0,
	activeSubagentCount: 0,
	dominantOperationId: null,
	blockingInteractionId: null,
};
const runningTurnState: SessionTurnState = "Running";

const canonicalProjectionFixture: CanonicalSessionProjection = {
	lifecycle: {
		status: "ready",
		actionability: {
			canSend: true,
			canResume: false,
			canRetry: false,
			canArchive: true,
			canConfigure: true,
			recommendedAction: "send",
			recoveryPhase: "none",
			compactStatus: "ready",
		},
		failureReason: null,
		errorMessage: null,
		detachedReason: null,
	},
	activity: awaitingModelActivity,
	turnState: runningTurnState,
	activeTurnFailure: null,
	lastTerminalTurnId: null,
	activeStreamingTail: null,
	capabilities: {
		models: null,
		modes: null,
		availableCommands: null,
		configOptions: null,
		autonomousEnabled: null,
	},
	revision: { graphRevision: 1, transcriptRevision: 1, lastEventSeq: 1 },
};

describe("AwaitingModelRefreshStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not re-arm the stuck-turn refresh timer for a session the controller has given up on", () => {
		// A session that already failed to refresh MAX_CONSECUTIVE_REFRESH_FAILURES
		// times in a row (SessionStateRefreshController.hasGivenUpOnSession) will
		// keep failing the same way -- re-arming this timer forever for it is
		// exactly the 90+ second SESSION_NOT_FOUND hammering from AC #266.
		const refreshSessionStateSnapshot = vi.fn(() => Effect.succeed(undefined));
		const store = new AwaitingModelRefreshStore({
			refreshSessionStateSnapshot,
			getCanonicalProjection: () => null,
			hasGivenUpOnSession: () => true,
		});

		store.syncAwaitingModelRefreshTimer("session-1", awaitingModelActivity, runningTurnState);
		vi.advanceTimersByTime(60_000);

		expect(refreshSessionStateSnapshot).not.toHaveBeenCalled();
	});

	it("still refreshes on the stuck-turn timer while the controller has not given up", () => {
		const refreshSessionStateSnapshot = vi.fn(() => Effect.succeed(undefined));
		const store = new AwaitingModelRefreshStore({
			refreshSessionStateSnapshot,
			getCanonicalProjection: () => canonicalProjectionFixture,
			hasGivenUpOnSession: () => false,
		});

		store.syncAwaitingModelRefreshTimer("session-1", awaitingModelActivity, runningTurnState);
		vi.advanceTimersByTime(5_000);

		expect(refreshSessionStateSnapshot).toHaveBeenCalledWith("session-1");
	});
});

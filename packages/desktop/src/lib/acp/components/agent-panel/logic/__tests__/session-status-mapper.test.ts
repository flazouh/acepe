import { describe, expect, it } from "bun:test";

import type { SessionGraphLifecycle } from "$lib/services/acp-types.js";
import {
	deriveCanonicalAgentPanelSessionState,
	mapCanonicalSessionToPanelStatus,
	mapSessionStatusToUI,
	resolveCanonicalAgentPanelSessionSource,
	resolveCanonicalAgentPanelTurnState,
} from "../session-status-mapper";

function lifecycle(
	status: SessionGraphLifecycle["status"],
	canResume = false,
	canRetry = false,
	canSend = status === "ready"
): SessionGraphLifecycle {
	return {
		status,
		detachedReason: status === "detached" ? "restoredRequiresAttach" : null,
		failureReason: status === "failed" ? "resumeFailed" : null,
		errorMessage: status === "failed" ? "Connection failed" : null,
		actionability: {
			canSend,
			canResume,
			canRetry,
			canArchive: status !== "archived",
			canConfigure: canSend,
			recommendedAction: canSend ? "send" : canResume ? "resume" : canRetry ? "retry" : "wait",
			recoveryPhase:
				status === "detached"
					? "detached"
					: status === "failed"
						? "failed"
						: status === "activating"
							? "activating"
							: status === "reconnecting"
								? "reconnecting"
								: status === "archived"
									? "archived"
									: "none",
			compactStatus: status,
		},
	};
}

describe("mapSessionStatusToUI", () => {
	it('should map "idle" to "empty"', () => {
		expect(mapSessionStatusToUI("idle")).toBe("empty");
	});

	it('should map "connecting" to "warming"', () => {
		expect(mapSessionStatusToUI("connecting")).toBe("warming");
	});

	it('should map "ready" to "connected"', () => {
		expect(mapSessionStatusToUI("ready")).toBe("connected");
	});

	it('should map "streaming" to "connected"', () => {
		expect(mapSessionStatusToUI("streaming")).toBe("connected");
	});

	it('should map "error" to "error"', () => {
		expect(mapSessionStatusToUI("error")).toBe("error");
	});

	it('should map undefined to "empty"', () => {
		expect(mapSessionStatusToUI(undefined)).toBe("empty");
	});

	it('should map null to "empty"', () => {
		expect(mapSessionStatusToUI(null)).toBe("empty");
	});

	it('should map unknown status to "empty"', () => {
		expect(mapSessionStatusToUI("loading" as never)).toBe("empty");
	});

	it('should map "paused" to "empty"', () => {
		expect(mapSessionStatusToUI("paused")).toBe("empty");
	});
});

describe("mapCanonicalSessionToPanelStatus", () => {
	it("maps ready/sendable lifecycle to connected presentation", () => {
		expect(
			mapCanonicalSessionToPanelStatus({
				lifecycle: lifecycle("ready"),
				activity: {
					kind: "idle",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Idle",
				hasEntries: true,
			})
		).toBe("connected");
	});

	it("maps detached/restorable lifecycle to idle instead of empty", () => {
		expect(
			mapCanonicalSessionToPanelStatus({
				lifecycle: lifecycle("detached", true),
				activity: {
					kind: "paused",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Idle",
				hasEntries: true,
			})
		).toBe("idle");
	});

	it("maps reserved and activating lifecycle to warming explicitly", () => {
		expect(mapCanonicalSessionToPanelStatus({ lifecycle: lifecycle("reserved") })).toBe("warming");
		expect(mapCanonicalSessionToPanelStatus({ lifecycle: lifecycle("activating") })).toBe(
			"warming"
		);
	});

	it("maps failed retryable lifecycle to error presentation", () => {
		expect(mapCanonicalSessionToPanelStatus({ lifecycle: lifecycle("failed", false, true) })).toBe(
			"error"
		);
	});

	it("maps failed turn state to error presentation even if activity is stale awaiting-model", () => {
		expect(
			mapCanonicalSessionToPanelStatus({
				lifecycle: lifecycle("ready"),
				activity: {
					kind: "awaiting_model",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Failed",
				hasEntries: true,
			})
		).toBe("error");
	});

	it("maps archived lifecycle to idle read-only presentation", () => {
		expect(mapCanonicalSessionToPanelStatus({ lifecycle: lifecycle("archived") })).toBe("idle");
	});
});

describe("deriveCanonicalAgentPanelSessionState", () => {
	it("uses completed idle canonical state for send-ready reopened sessions", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("ready"),
				activity: {
					kind: "idle",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Completed",
			},
			hasEntries: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "done",
			isConnected: true,
			isStreaming: false,
			localPlaceholderMode: "none",
			canSubmit: true,
			showStop: false,
		});
	});

	it("keeps pre-canonical optimistic sends in warming presentation", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "no_session",
			},
			hasEntries: true,
			hasOptimisticPendingEntry: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "warming",
			isConnected: false,
			isStreaming: false,
			localPlaceholderMode: "connection",
			canSubmit: false,
			showStop: false,
		});
	});

	it("fails visible when a real session has no canonical graph", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "missing_canonical",
				sessionId: "session-1",
			},
			hasEntries: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "error",
			isConnected: false,
			isStreaming: false,
			localPlaceholderMode: "none",
			canSubmit: false,
			showStop: false,
		});
	});

	it("keeps a newly spawned pending send warming while canonical graph hydrates", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "missing_canonical",
				sessionId: "session-1",
			},
			hasEntries: true,
			hasLocalPendingSendIntent: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "warming",
			isConnected: false,
			isStreaming: false,
			localPlaceholderMode: "connection",
			canSubmit: false,
			showStop: false,
		});
	});

	it("exposes post-tool planning intent while the canonical turn awaits the model", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("ready", false, false, false),
				activity: {
					kind: "awaiting_model",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Running",
			},
			hasEntries: true,
			hasTrailingCompletedTool: true,
		});

		expect(state).toEqual({
			sessionStatus: "running",
			isConnected: true,
			isStreaming: true,
			localPlaceholderMode: "planning_after_tool",
			canSubmit: false,
			showStop: true,
		});
	});

	it("uses cancelled canonical turn state as sendable idle feedback", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("ready", false, false, true),
				activity: {
					kind: "idle",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Cancelled",
			},
			hasEntries: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "connected",
			isConnected: true,
			isStreaming: false,
			localPlaceholderMode: "none",
			canSubmit: true,
			showStop: false,
		});
	});

	it("does not add synthetic feedback for a local send intent on a ready session", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("ready", false, false, true),
				activity: null,
				turnState: "Completed",
			},
			hasEntries: true,
			hasLocalPendingSendIntent: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "connected",
			isConnected: true,
			isStreaming: false,
			localPlaceholderMode: "none",
			canSubmit: false,
			showStop: false,
		});
	});

	it("shows connecting feedback while a pending session is activating", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("activating", false, false, false),
				activity: null,
				turnState: null,
			},
			hasLocalPendingSendIntent: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "warming",
			isConnected: false,
			isStreaming: false,
			localPlaceholderMode: "connection",
			canSubmit: false,
			showStop: false,
		});
	});

	it("keeps branded connection feedback while a pending session reconnects", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("reconnecting", false, false, false),
				activity: null,
				turnState: null,
			},
			hasLocalPendingSendIntent: true,
			hasTrailingCompletedTool: false,
		});

		expect(state.localPlaceholderMode).toBe("connection");
	});

	it("does not claim post-tool planning without a completed trailing tool", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("ready", false, false, true),
				activity: {
					kind: "awaiting_model",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Running",
			},
			hasEntries: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "running",
			isConnected: true,
			isStreaming: true,
			localPlaceholderMode: "none",
			canSubmit: false,
			showStop: true,
		});
	});

	it("does not show planning when the canonical lifecycle has failed", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("failed", false, true, false),
				activity: {
					kind: "awaiting_model",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Running",
			},
			hasEntries: true,
			hasLocalPendingSendIntent: true,
			hasOptimisticPendingEntry: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "error",
			isConnected: false,
			isStreaming: false,
			localPlaceholderMode: "none",
			canSubmit: false,
			showStop: false,
		});
	});

	it("does not show planning when the canonical turn has failed", () => {
		const state = deriveCanonicalAgentPanelSessionState({
			source: {
				kind: "canonical",
				lifecycle: lifecycle("ready", false, false, true),
				activity: {
					kind: "awaiting_model",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Failed",
			},
			hasEntries: true,
			hasTrailingCompletedTool: false,
		});

		expect(state).toEqual({
			sessionStatus: "error",
			isConnected: true,
			isStreaming: false,
			localPlaceholderMode: "none",
			canSubmit: true,
			showStop: false,
		});
	});
});

describe("resolveCanonicalAgentPanelSessionSource", () => {
	it("returns no-session source before a session exists", () => {
		expect(
			resolveCanonicalAgentPanelSessionSource({
				sessionId: null,
				lifecycle: null,
				activity: null,
				turnState: null,
			})
		).toEqual({ kind: "no_session" });
	});

	it("returns missing-canonical source when a session has no graph lifecycle", () => {
		expect(
			resolveCanonicalAgentPanelSessionSource({
				sessionId: "session-1",
				lifecycle: null,
				activity: null,
				turnState: null,
			})
		).toEqual({ kind: "missing_canonical", sessionId: "session-1" });
	});

	it("keeps null turn state explicit on canonical source", () => {
		const source = resolveCanonicalAgentPanelSessionSource({
			sessionId: "session-1",
			lifecycle: lifecycle("ready"),
			activity: {
				kind: "idle",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			turnState: null,
		});

		expect(source.kind).toBe("canonical");
		if (source.kind === "canonical") {
			expect(source.turnState).toBeNull();
		}
	});
});

describe("resolveCanonicalAgentPanelTurnState", () => {
	it("maps missing canonical data to visible error state", () => {
		expect(
			resolveCanonicalAgentPanelTurnState({
				kind: "missing_canonical",
				sessionId: "session-1",
			})
		).toBe("error");
	});

	it("uses idle when canonical turn state is not known yet", () => {
		expect(
			resolveCanonicalAgentPanelTurnState({
				kind: "canonical",
				lifecycle: lifecycle("ready"),
				activity: null,
				turnState: null,
			})
		).toBe("idle");
	});

	it("maps canonical running turn state for presentation", () => {
		expect(
			resolveCanonicalAgentPanelTurnState({
				kind: "canonical",
				lifecycle: lifecycle("ready"),
				activity: null,
				turnState: "Running",
			})
		).toBe("streaming");
	});
});

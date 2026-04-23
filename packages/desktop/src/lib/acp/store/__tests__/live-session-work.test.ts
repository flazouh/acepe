import { describe, expect, it } from "bun:test";

import type { ToolCall } from "../../types/tool-call.js";
import { deriveLiveCanonicalActivity, deriveLiveSessionState } from "../live-session-work.js";

function makeToolCall(): ToolCall {
	return {
		id: "tool-1",
		name: "task",
		arguments: { kind: "other", raw: {} },
		status: "pending",
		kind: "other",
		awaitingPlanApproval: false,
	};
}

describe("deriveLiveSessionState", () => {
	it("preserves thinking when runtime reports running with showThinking", () => {
		const state = deriveLiveSessionState({
			runtimeState: {
				connectionPhase: "connected",
				contentPhase: "loaded",
				activityPhase: "running",
				canSubmit: false,
				canCancel: true,
				showStop: true,
				showThinking: true,
				showConnectingOverlay: false,
				showConversation: true,
				showReadyPlaceholder: false,
			},
			hotState: {
				status: "ready",
				currentMode: null,
				connectionError: null,
			},
			currentStreamingToolCall: null,
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPlanApproval: null,
				pendingPermission: null,
			},
			hasUnseenCompletion: false,
		});

		expect(state.connection).toBe("connected");
		expect(state.activity.kind).toBe("thinking");
	});

	it("lets active tool work dominate awaiting-model fallback when graph authority is absent", () => {
		const state = deriveLiveSessionState({
			runtimeState: {
				connectionPhase: "connected",
				contentPhase: "loaded",
				activityPhase: "running",
				canSubmit: false,
				canCancel: true,
				showStop: true,
				showThinking: true,
				showConnectingOverlay: false,
				showConversation: true,
				showReadyPlaceholder: false,
			},
			hotState: {
				status: "ready",
				currentMode: null,
				connectionError: null,
			},
			currentStreamingToolCall: makeToolCall(),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPlanApproval: null,
				pendingPermission: null,
			},
			hasUnseenCompletion: false,
		});

		expect(state.connection).toBe("connected");
		expect(state.activity.kind).toBe("streaming");
	});

	it("projects graph-backed running activity even when no live tool call is available", () => {
		const canonicalActivity = deriveLiveCanonicalActivity({
			runtimeState: {
				connectionPhase: "connected",
				contentPhase: "loaded",
				activityPhase: "idle",
				canSubmit: true,
				canCancel: false,
				showStop: false,
				showThinking: false,
				showConnectingOverlay: false,
				showConversation: true,
				showReadyPlaceholder: false,
			},
			hotState: {
				status: "ready",
				currentMode: null,
				connectionError: null,
				activity: {
					kind: "running_operation",
					activeOperationCount: 2,
					activeSubagentCount: 1,
					dominantOperationId: "op-2",
					blockingInteractionId: null,
				},
			},
			currentStreamingToolCall: null,
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPlanApproval: null,
				pendingPermission: null,
			},
			hasUnseenCompletion: false,
		});

		expect(canonicalActivity).toBe("running_operation");
	});

	it("keeps pending interaction dominant when graph-backed activity is absent", () => {
		const canonicalActivity = deriveLiveCanonicalActivity({
			runtimeState: {
				connectionPhase: "connected",
				contentPhase: "loaded",
				activityPhase: "idle",
				canSubmit: true,
				canCancel: false,
				showStop: false,
				showThinking: false,
				showConnectingOverlay: false,
				showConversation: true,
				showReadyPlaceholder: false,
			},
			hotState: {
				status: "ready",
				currentMode: null,
				connectionError: null,
			},
			currentStreamingToolCall: null,
			interactionSnapshot: {
				pendingQuestion: {
					id: "question-1",
					sessionId: "session-1",
					questions: [],
				},
				pendingPlanApproval: null,
				pendingPermission: null,
			},
			hasUnseenCompletion: false,
		});

		expect(canonicalActivity).toBe("waiting_for_user");
	});

	it("keeps active tool work dominant when graph-backed activity is absent", () => {
		const canonicalActivity = deriveLiveCanonicalActivity({
			runtimeState: {
				connectionPhase: "connected",
				contentPhase: "loaded",
				activityPhase: "idle",
				canSubmit: true,
				canCancel: false,
				showStop: false,
				showThinking: false,
				showConnectingOverlay: false,
				showConversation: true,
				showReadyPlaceholder: false,
			},
			hotState: {
				status: "ready",
				currentMode: null,
				connectionError: null,
			},
			currentStreamingToolCall: makeToolCall(),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPlanApproval: null,
				pendingPermission: null,
			},
			hasUnseenCompletion: false,
		});

		expect(canonicalActivity).toBe("running_operation");
	});
});

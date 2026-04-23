import { describe, expect, it } from "bun:test";

import type { ToolCall } from "../../types/tool-call.js";
import { deriveLiveSessionState } from "../live-session-work.js";

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

	it("prefers streaming when an active tool call still exists", () => {
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
});

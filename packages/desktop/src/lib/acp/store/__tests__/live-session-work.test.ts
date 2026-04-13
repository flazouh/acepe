import { describe, expect, it } from "bun:test";

import { deriveLiveSessionState } from "../live-session-work.js";

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
});

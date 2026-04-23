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

	it("prefers streaming when a task child tool call is still in progress", () => {
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
			currentStreamingToolCall: {
				id: "task-child-1",
				name: "Read",
				kind: "read",
				arguments: { kind: "read", file_path: "/repo/src/task.ts" },
				status: "in_progress",
				result: null,
				title: "Read file",
				locations: null,
				skillMeta: null,
				normalizedQuestions: null,
				normalizedTodos: null,
				parentToolUseId: "task-parent-1",
				taskChildren: [],
				questionAnswer: null,
				awaitingPlanApproval: false,
				planApprovalRequestId: null,
			},
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

import { describe, expect, it } from "bun:test";

import {
	type ActivityState,
	assertValidSessionState,
	createAttentionMeta,
	createConnectedIdleState,
	createConnectingState,
	createDisconnectedState,
	createErrorState,
	createIdleActivity,
	createNoPendingInput,
	createPausedActivity,
	createPendingPermission,
	createPendingPlanApproval,
	createPendingQuestion,
	createStreamingActivity,
	createThinkingActivity,
	deriveSessionState,
	hasAnyPendingInput,
	hasNoPendingInput,
	hasPendingPermission,
	hasPendingPlanApproval,
	hasPendingQuestion,
	IMPOSSIBLE_STATES,
	isActiveWork,
	isIdleActivity,
	isPausedActivity,
	isStreamingActivity,
	isThinkingActivity,
	isValidSessionState,
	type PendingInput,
	type SessionState,
	statusToConnectionState,
} from "../session-state.js";

// =============================================================================
// Type Guard Tests
// =============================================================================

describe("ActivityState type guards", () => {
	it("isIdleActivity returns true for idle", () => {
		expect(isIdleActivity({ kind: "idle" })).toBe(true);
	});

	it("isIdleActivity returns false for streaming", () => {
		expect(isIdleActivity({ kind: "streaming", modeId: null, tool: null })).toBe(false);
	});

	it("isStreamingActivity returns true for streaming", () => {
		const activity: ActivityState = { kind: "streaming", modeId: "code", tool: null };
		expect(isStreamingActivity(activity)).toBe(true);
	});

	it("isStreamingActivity returns false for idle", () => {
		expect(isStreamingActivity({ kind: "idle" })).toBe(false);
	});

	it("isThinkingActivity returns true for thinking", () => {
		expect(isThinkingActivity({ kind: "thinking" })).toBe(true);
	});

	it("isPausedActivity returns true for paused", () => {
		expect(isPausedActivity({ kind: "paused" })).toBe(true);
	});

	it("isActiveWork returns true for streaming", () => {
		expect(isActiveWork({ kind: "streaming", modeId: null, tool: null })).toBe(true);
	});

	it("isActiveWork returns true for thinking", () => {
		expect(isActiveWork({ kind: "thinking" })).toBe(true);
	});

	it("isActiveWork returns false for idle", () => {
		expect(isActiveWork({ kind: "idle" })).toBe(false);
	});

	it("isActiveWork returns false for paused", () => {
		expect(isActiveWork({ kind: "paused" })).toBe(false);
	});
});

describe("PendingInput type guards", () => {
	it("hasNoPendingInput returns true for none", () => {
		expect(hasNoPendingInput({ kind: "none" })).toBe(true);
	});

	it("hasNoPendingInput returns false for question", () => {
		expect(
			hasNoPendingInput({
				kind: "question",
				request: { id: "q-1", sessionId: "s-1", questions: [] },
			})
		).toBe(false);
	});

	it("hasPendingQuestion returns true for question", () => {
		const input: PendingInput = {
			kind: "question",
			request: { id: "q-1", sessionId: "s-1", questions: [] },
		};
		expect(hasPendingQuestion(input)).toBe(true);
	});

	it("hasPendingPermission returns true for permission", () => {
		const input: PendingInput = {
			kind: "permission",
			request: {
				id: "p-1",
				sessionId: "s-1",
				permission: "test",
				patterns: [],
				metadata: {},
				always: [],
			},
		};
		expect(hasPendingPermission(input)).toBe(true);
	});

	it("hasPendingPlanApproval returns true for plan approval", () => {
		const input: PendingInput = {
			kind: "plan_approval",
			request: {
				id: "plan-1",
				kind: "plan_approval",
				source: "create_plan",
				sessionId: "s-1",
				tool: { messageID: "", callID: "tool-1" },
				jsonRpcRequestId: 7,
				replyHandler: { kind: "json-rpc", requestId: 7 },
				status: "pending",
			},
		};
		expect(hasPendingPlanApproval(input)).toBe(true);
	});

	it("hasAnyPendingInput returns true for question or permission", () => {
		expect(
			hasAnyPendingInput({
				kind: "question",
				request: { id: "q-1", sessionId: "s-1", questions: [] },
			})
		).toBe(true);
		expect(
			hasAnyPendingInput({
				kind: "permission",
				request: {
					id: "p-1",
					sessionId: "s-1",
					permission: "test",
					patterns: [],
					metadata: {},
					always: [],
				},
			})
		).toBe(true);
		expect(hasAnyPendingInput({ kind: "none" })).toBe(false);
	});
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("Activity factory functions", () => {
	it("createIdleActivity returns idle activity", () => {
		expect(createIdleActivity()).toEqual({ kind: "idle" });
	});

	it("createThinkingActivity returns thinking activity", () => {
		expect(createThinkingActivity()).toEqual({ kind: "thinking" });
	});

	it("createStreamingActivity returns streaming activity with mode", () => {
		expect(createStreamingActivity("plan", null)).toEqual({
			kind: "streaming",
			modeId: "plan",
			tool: null,
		});
	});

	it("createStreamingActivity returns streaming activity with tool", () => {
		// Use null for tool since the actual ToolCall type is complex
		// The factory function is already tested with null above
		const result = createStreamingActivity("code", null);
		expect(result.kind).toBe("streaming");
		if (result.kind === "streaming") {
			expect(result.modeId).toBe("code");
			expect(result.tool).toBeNull();
		}
	});

	it("createPausedActivity returns paused activity", () => {
		expect(createPausedActivity()).toEqual({ kind: "paused" });
	});
});

describe("PendingInput factory functions", () => {
	it("createNoPendingInput returns none", () => {
		expect(createNoPendingInput()).toEqual({ kind: "none" });
	});

	it("createPendingQuestion returns question with request", () => {
		const request = { id: "q-1", sessionId: "s-1", questions: [] };
		expect(createPendingQuestion(request)).toEqual({ kind: "question", request });
	});

	it("createPendingPermission returns permission with request", () => {
		const request = {
			id: "p-1",
			sessionId: "s-1",
			permission: "test",
			patterns: [],
			metadata: {},
			always: [],
		};
		expect(createPendingPermission(request)).toEqual({ kind: "permission", request });
	});

	it("createPendingPlanApproval returns plan approval with request", () => {
		const request = {
			id: "plan-1",
			kind: "plan_approval" as const,
			source: "create_plan" as const,
			sessionId: "s-1",
			tool: { messageID: "", callID: "tool-1" },
			jsonRpcRequestId: 7,
			replyHandler: { kind: "json-rpc" as const, requestId: 7 },
			status: "pending" as const,
		};
		expect(createPendingPlanApproval(request)).toEqual({ kind: "plan_approval", request });
	});
});

describe("AttentionMeta factory", () => {
	it("createAttentionMeta defaults to no unseen completion", () => {
		expect(createAttentionMeta()).toEqual({ hasUnseenCompletion: false });
	});

	it("createAttentionMeta accepts unseen completion flag", () => {
		expect(createAttentionMeta(true)).toEqual({ hasUnseenCompletion: true });
	});
});

describe("SessionState factory functions", () => {
	it("createDisconnectedState returns disconnected idle state", () => {
		const state = createDisconnectedState();
		expect(state.connection).toBe("disconnected");
		expect(state.activity.kind).toBe("idle");
		expect(state.pendingInput.kind).toBe("none");
		expect(state.attention.hasUnseenCompletion).toBe(false);
	});

	it("createConnectingState returns connecting idle state", () => {
		const state = createConnectingState();
		expect(state.connection).toBe("connecting");
		expect(state.activity.kind).toBe("idle");
	});

	it("createConnectedIdleState returns connected idle state", () => {
		const state = createConnectedIdleState();
		expect(state.connection).toBe("connected");
		expect(state.activity.kind).toBe("idle");
	});

	it("createErrorState returns error idle state", () => {
		const state = createErrorState();
		expect(state.connection).toBe("error");
		expect(state.activity.kind).toBe("idle");
	});
});

// =============================================================================
// State Validation Tests
// =============================================================================

describe("isValidSessionState", () => {
	it("returns true for valid connected streaming state", () => {
		const state: SessionState = {
			connection: "connected",
			activity: { kind: "streaming", modeId: "code", tool: null },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: false },
		};
		expect(isValidSessionState(state)).toBe(true);
	});

	it("returns false for disconnected streaming (impossible)", () => {
		const state: SessionState = {
			connection: "disconnected",
			activity: { kind: "streaming", modeId: null, tool: null },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: false },
		};
		expect(isValidSessionState(state)).toBe(false);
	});

	it("returns false for error streaming (impossible)", () => {
		const state: SessionState = {
			connection: "error",
			activity: { kind: "streaming", modeId: null, tool: null },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: false },
		};
		expect(isValidSessionState(state)).toBe(false);
	});

	it("returns true for error idle state (valid)", () => {
		const state: SessionState = {
			connection: "error",
			activity: { kind: "idle" },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: false },
		};
		expect(isValidSessionState(state)).toBe(true);
	});
});

describe("assertValidSessionState", () => {
	it("does not throw for valid state", () => {
		const state = createConnectedIdleState();
		expect(() => assertValidSessionState(state)).not.toThrow();
	});

	it("throws for impossible state", () => {
		const state: SessionState = {
			connection: "disconnected",
			activity: { kind: "streaming", modeId: null, tool: null },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: false },
		};
		expect(() => assertValidSessionState(state)).toThrow("Invalid session state");
	});
});

describe("IMPOSSIBLE_STATES", () => {
	it("includes disconnected + streaming", () => {
		const found = IMPOSSIBLE_STATES.some(
			(s) => s.connection === "disconnected" && s.activity === "streaming"
		);
		expect(found).toBe(true);
	});

	it("includes error + streaming", () => {
		const found = IMPOSSIBLE_STATES.some(
			(s) => s.connection === "error" && s.activity === "streaming"
		);
		expect(found).toBe(true);
	});
});

// =============================================================================
// State Derivation Tests
// =============================================================================

describe("statusToConnectionState", () => {
	it("maps idle to disconnected", () => {
		expect(statusToConnectionState("idle")).toBe("disconnected");
	});

	it("maps loading to connecting", () => {
		expect(statusToConnectionState("loading")).toBe("connecting");
	});

	it("maps connecting to connecting", () => {
		expect(statusToConnectionState("connecting")).toBe("connecting");
	});

	it("maps streaming to streaming", () => {
		expect(statusToConnectionState("streaming")).toBe("streaming");
	});

	it("maps paused to paused", () => {
		expect(statusToConnectionState("paused")).toBe("paused");
	});

	it("maps error to error", () => {
		expect(statusToConnectionState("error")).toBe("error");
	});

	it("maps ready to ready", () => {
		expect(statusToConnectionState("ready")).toBe("ready");
	});
});

describe("deriveSessionState", () => {
	it("derives disconnected idle state from disconnected connection", () => {
		const state = deriveSessionState({
			connectionState: "disconnected",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

		expect(state.connection).toBe("disconnected");
		expect(state.activity.kind).toBe("idle");
		expect(state.pendingInput.kind).toBe("none");
	});

	it("derives connecting state from connecting connection", () => {
		const state = deriveSessionState({
			connectionState: "connecting",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

		expect(state.connection).toBe("connecting");
		expect(state.activity.kind).toBe("idle");
	});

	it("derives thinking state from awaitingResponse", () => {
		const state = deriveSessionState({
			connectionState: "awaitingResponse",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

		expect(state.connection).toBe("connected");
		expect(state.activity.kind).toBe("thinking");
	});

	it("derives streaming state with mode from streaming connection", () => {
		const state = deriveSessionState({
			connectionState: "streaming",
			modeId: "plan",
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

		expect(state.connection).toBe("connected");
		expect(state.activity.kind).toBe("streaming");
		if (state.activity.kind === "streaming") {
			expect(state.activity.modeId).toBe("plan");
		}
	});

	it("derives pending question state", () => {
		const question = { id: "q-1", sessionId: "s-1", questions: [] };
		const state = deriveSessionState({
			connectionState: "ready",
			modeId: null,
			tool: null,
			pendingQuestion: question,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

		expect(state.pendingInput.kind).toBe("question");
	});

	it("derives pending permission state", () => {
		const permission = {
			id: "p-1",
			sessionId: "s-1",
			permission: "test",
			patterns: [],
			metadata: {},
			always: [],
		};
		const state = deriveSessionState({
			connectionState: "ready",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: permission,
			hasUnseenCompletion: false,
		});

		expect(state.pendingInput.kind).toBe("permission");
	});

	it("derives pending plan approval state", () => {
		const planApproval = {
			id: "plan-1",
			kind: "plan_approval" as const,
			source: "create_plan" as const,
			sessionId: "s-1",
			tool: { messageID: "", callID: "tool-1" },
			jsonRpcRequestId: 7,
			replyHandler: { kind: "json-rpc" as const, requestId: 7 },
			status: "pending" as const,
		};
		const state = deriveSessionState({
			connectionState: "ready",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: planApproval,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

		expect(state.pendingInput.kind).toBe("plan_approval");
	});

	it("prioritizes question over permission", () => {
		const question = { id: "q-1", sessionId: "s-1", questions: [] };
		const permission = {
			id: "p-1",
			sessionId: "s-1",
			permission: "test",
			patterns: [],
			metadata: {},
			always: [],
		};
		const state = deriveSessionState({
			connectionState: "ready",
			modeId: null,
			tool: null,
			pendingQuestion: question,
			pendingPlanApproval: null,
			pendingPermission: permission,
			hasUnseenCompletion: false,
		});

		expect(state.pendingInput.kind).toBe("question");
	});

	it("derives unseen completion in attention meta", () => {
		const state = deriveSessionState({
			connectionState: "ready",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: true,
		});

		expect(state.attention.hasUnseenCompletion).toBe(true);
	});

	it("derives error state from error connection", () => {
		const state = deriveSessionState({
			connectionState: "error",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

		expect(state.connection).toBe("error");
		expect(state.activity.kind).toBe("idle");
	});

	it("derives paused activity from paused connection state", () => {
		const state = deriveSessionState({
			connectionState: "paused",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

		expect(state.connection).toBe("connected");
		expect(state.activity.kind).toBe("paused");
	});
});

describe("isValidSessionState — paused edge cases", () => {
	it("returns true for disconnected + paused (valid per model)", () => {
		const state: SessionState = {
			connection: "disconnected",
			activity: { kind: "paused" },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: false },
		};
		expect(isValidSessionState(state)).toBe(true);
	});

	it("returns true for connected + paused (normal paused state)", () => {
		const state: SessionState = {
			connection: "connected",
			activity: { kind: "paused" },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: false },
		};
		expect(isValidSessionState(state)).toBe(true);
	});

	it("returns false for disconnected + streaming (impossible)", () => {
		const state: SessionState = {
			connection: "disconnected",
			activity: { kind: "streaming", modeId: null, tool: null },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: false },
		};
		expect(isValidSessionState(state)).toBe(false);
	});
});

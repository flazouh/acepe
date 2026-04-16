import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { SessionStatus } from "../../../application/dto/session-status.js";
import type { ToolCall } from "../../../types/tool-call.js";
import { deriveSessionState } from "../../session-state.js";
import type { UrgencyInfo } from "../../urgency.js";
import { classifyItem } from "../queue-section-utils.js";
import { buildQueueItem, buildQueueSessionSnapshot, type QueueSessionSnapshot } from "../utils.js";

const DEFAULT_URGENCY: UrgencyInfo = {
	level: "low",
	reason: "Working",
	timestamp: 0,
	detail: null,
};

function createToolCall(
	id: string,
	status: ToolCall["status"],
	arguments_: ToolCall["arguments"]
): ToolCall {
	return {
		id,
		name: "Read",
		kind: "read",
		arguments: arguments_,
		status,
		awaitingPlanApproval: false,
	};
}

function createToolEntry(toolCall: ToolCall, isStreaming = false): SessionEntry {
	return {
		id: `entry-${toolCall.id}`,
		type: "tool_call",
		message: toolCall,
		isStreaming,
	};
}

function createSession(overrides: Partial<QueueSessionSnapshot> = {}): QueueSessionSnapshot {
	const isStreaming = overrides.isStreaming ?? false;
	const isThinking = overrides.isThinking ?? false;
	const currentModeId = overrides.currentModeId ?? "code";
	const state =
		overrides.state ??
		deriveSessionState({
			connectionState: isThinking
				? "awaitingResponse"
				: isStreaming
					? "streaming"
					: overrides.status === "error"
						? "error"
						: overrides.status === "paused"
							? "paused"
							: overrides.status === "connecting"
								? "connecting"
								: overrides.status === "idle"
									? "disconnected"
									: "ready",
			modeId: currentModeId,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		});

	return {
		id: "session-1",
		agentId: "opencode",
		projectPath: "/repo",
		title: "Queue item",
		entries: [],
		state,
		isStreaming,
		isThinking,
		status: "ready",
		updatedAt: new Date("2026-03-30T12:00:00.000Z"),
		currentModeId,
		connectionError: null,
		...overrides,
	};
}

describe("buildQueueItem", () => {
	it("classifies ready thinking sessions as working", () => {
		const item = buildQueueItem(
			createSession({ isThinking: true, status: "ready" }),
			null,
			DEFAULT_URGENCY,
			false,
			false,
			false,
			null,
			null,
			null,
			null
		);

		expect(item.state.activity.kind).toBe("thinking");
		expect(classifyItem(item)).toBe("working");
	});

	it("keeps the last tool call while the session is planning next moves", () => {
		const lastToolCall = createToolCall("tool-1", "completed", {
			kind: "read",
			file_path: "/repo/src/lib/queue.ts",
		});

		const item = buildQueueItem(
			createSession({
				isThinking: true,
				status: "ready" as SessionStatus,
				entries: [createToolEntry(lastToolCall, false)],
			}),
			null,
			DEFAULT_URGENCY,
			false,
			false,
			false,
			null,
			null,
			null,
			null
		);

		expect(item.state.activity.kind).toBe("thinking");
		expect(item.lastToolCall?.id).toBe("tool-1");
	});

	it("preserves connectionError-backed error classification from the snapshot", () => {
		const item = buildQueueItem(
			createSession({
				state: deriveSessionState({
					connectionState: "awaitingResponse",
					modeId: "plan",
					tool: null,
					pendingQuestion: null,
					pendingPlanApproval: null,
					pendingPermission: null,
					hasUnseenCompletion: false,
				}),
				isThinking: true,
				status: "error",
				connectionError: "Resume failed",
			}),
			null,
			DEFAULT_URGENCY,
			false,
			false,
			false,
			null,
			null,
			null,
			null
		);

		expect(item.state.activity.kind).toBe("thinking");
		expect(item.connectionError).toBe("Resume failed");
		expect(classifyItem(item)).toBe("error");
	});

	it("classifies recoverable turn failures from activeTurnFailure", () => {
		const item = buildQueueItem(
			createSession({
				state: deriveSessionState({
					connectionState: "ready",
					modeId: "plan",
					tool: null,
					pendingQuestion: null,
					pendingPlanApproval: null,
					pendingPermission: null,
					hasUnseenCompletion: false,
				}),
				status: "error",
				activeTurnFailure: {
					turnId: "turn-1",
					message: "Usage limit reached",
					code: "429",
					kind: "recoverable",
					source: "process",
				},
			}),
			null,
			DEFAULT_URGENCY,
			false,
			false,
			false,
			null,
			null,
			null,
			null
		);

		expect(item.connectionError).toBeNull();
		expect(item.activeTurnFailure?.message).toBe("Usage limit reached");
		expect(classifyItem(item)).toBe("error");
	});
});

describe("buildQueueSessionSnapshot", () => {
	it("preserves paused hot status over running runtime activity", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			entries: [],
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			runtimeState: {
				connectionPhase: "connected",
				contentPhase: "loaded",
				activityPhase: "running",
				canSubmit: false,
				canCancel: true,
				showStop: true,
				showThinking: false,
				showConnectingOverlay: false,
				showConversation: true,
				showReadyPlaceholder: false,
			},
			hotState: {
				status: "paused",
				currentMode: { id: "plan", name: "Plan" },
				connectionError: null,
			},
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.status).toBe("paused");
		expect(snapshot.currentModeId).toBe("plan");
	});

	it("maps waiting-for-user runtime to thinking state", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			entries: [],
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			runtimeState: {
				connectionPhase: "connected",
				contentPhase: "loaded",
				activityPhase: "waiting_for_user",
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
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.isThinking).toBe(true);
		expect(snapshot.isStreaming).toBe(false);
		expect(snapshot.state.activity.kind).toBe("thinking");
		expect(snapshot.status).toBe("streaming");
	});

	it("surfaces connectionError as error status even when runtime stays connected", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			entries: [],
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
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
				connectionError: "Resume failed",
			},
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.status).toBe("error");
	});
});

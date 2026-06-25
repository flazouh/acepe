import { describe, expect, it } from "bun:test";

import type { SessionStatus } from "../../../application/dto/session-status.js";
import type { ComputerPermissionInteraction } from "../../../types/interaction.js";
import type { PermissionRequest } from "../../../types/permission.js";
import type { ToolCall } from "../../../types/tool-call.js";
import type { CanonicalSessionProjection } from "../../canonical-session-projection.js";
import { liveSessionWorkSourceFromCanonicalProjection } from "../../live-session-work.js";
import { deriveSessionState } from "../../session-state.js";
import { deriveSessionWorkProjection, selectSessionWorkBucket } from "../../session-work-projection.js";
import type { UrgencyInfo } from "../../urgency.js";
import { classifyItem } from "../queue-section-utils.js";
import { buildQueueItem, buildQueueSessionSnapshot, type QueueSessionSnapshot } from "../utils.js";

const DEFAULT_URGENCY: UrgencyInfo = {
	level: "low",
	reason: "Working",
	timestamp: 0,
	detail: null,
};

function makeCanonicalProjection(
	status: CanonicalSessionProjection["lifecycle"]["status"],
	activityKind: CanonicalSessionProjection["activity"]["kind"],
	errorMessage: string | null = null
): CanonicalSessionProjection {
	return {
		lifecycle: {
			status,
			errorMessage,
			detachedReason: null,
			failureReason: null,
			actionability: {
				canSend: status === "ready",
				canResume: status === "detached",
				canRetry: status === "failed",
				canArchive: true,
				canConfigure: status === "ready",
				recommendedAction: status === "ready" ? "send" : "wait",
				recoveryPhase: "none",
				compactStatus: status,
			},
		},
		activity: {
			kind: activityKind,
			activeOperationCount: activityKind === "running_operation" ? 1 : 0,
			activeSubagentCount: 0,
			dominantOperationId: activityKind === "running_operation" ? "op-1" : null,
			blockingInteractionId: null,
		},
		turnState: activityKind === "idle" ? "Idle" : "Running",
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		activeStreamingTail: null,
		capabilities: {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
		tokenStream: new Map(),
		clockAnchor: null,
		revision: {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
	};
}

function makeLiveSource(projection: CanonicalSessionProjection | null) {
	return liveSessionWorkSourceFromCanonicalProjection("session-1", projection);
}

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

function createSession(overrides: Partial<QueueSessionSnapshot> = {}): QueueSessionSnapshot {
	const isStreaming = overrides.isStreaming ?? false;
	const isThinking = overrides.isThinking ?? false;
	const currentModeId = overrides.currentModeId ?? "code";
	const currentStreamingToolCall = overrides.currentStreamingToolCall ?? null;
	const lastToolCall = overrides.lastToolCall ?? currentStreamingToolCall;
	const lastTodoToolCall = overrides.lastTodoToolCall ?? null;
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
	const workBucket =
		overrides.workBucket ??
		selectSessionWorkBucket(
			deriveSessionWorkProjection({
				state,
				currentModeId,
				connectionError: overrides.connectionError ?? null,
				activeTurnFailure: overrides.activeTurnFailure ?? null,
				canonicalActivity: null,
			})
		);

	return {
		id: "session-1",
		agentId: "opencode",
		projectPath: "/repo",
		title: "Queue item",
		currentStreamingToolCall,
		currentToolKind:
			overrides.currentToolKind ??
			(currentStreamingToolCall ? (currentStreamingToolCall.kind ?? "other") : null),
		lastToolCall,
		lastTodoToolCall,
		state,
		isStreaming,
		isThinking,
		status: "ready",
		workBucket,
		updatedAt: new Date("2026-03-30T12:00:00.000Z"),
		currentModeId,
		connectionError: null,
		sequenceId: null,
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
		expect(classifyItem(item)).toBe("planning");
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
				lastToolCall,
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

	it("derives todo progress from canonical lastTodoToolCall without transcript entries", () => {
		const item = buildQueueItem(
			createSession({
				lastTodoToolCall: {
					id: "todo-tool-1",
					name: "TodoWrite",
					kind: "other",
					arguments: { kind: "other", raw: {} },
					status: "in_progress",
					normalizedTodos: [
						{
							content: "Audit remaining consumers",
							activeForm: "Auditing remaining consumers",
							status: "completed",
						},
						{
							content: "Migrate queue summaries",
							activeForm: "Migrating queue summaries",
							status: "in_progress",
						},
					],
					awaitingPlanApproval: false,
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

		expect(item.todoProgress).toEqual({
			current: 2,
			total: 2,
			label: "Migrating queue summaries",
		});
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
			sequenceId: null,
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
	it("preserves session sequence id on queue items", () => {
		const item = buildQueueItem(
			createSession({ sequenceId: 7 }),
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

		expect(item.sequenceId).toBe(7);
	});
});

describe("buildQueueSessionSnapshot", () => {
	it("derives ready idle presentation from canonical state without runtime help", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: "plan",
			connectionError: null,
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(makeCanonicalProjection("ready", "idle")),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.status).toBe("ready");
		expect(snapshot.state.connection).toBe("connected");
		expect(snapshot.state.activity.kind).toBe("idle");
		expect(snapshot.isStreaming).toBe(false);
		expect(snapshot.isThinking).toBe(false);
	});

	it("preserves canonical paused activity over running runtime activity", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: "plan",
			connectionError: null,
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(makeCanonicalProjection("ready", "paused")),
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

	it("does not map waiting-for-user runtime to thinking when canonical activity is idle", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: null,
			connectionError: null,
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(makeCanonicalProjection("ready", "idle")),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.isThinking).toBe(false);
		expect(snapshot.isStreaming).toBe(false);
		expect(snapshot.state.activity.kind).toBe("idle");
		expect(snapshot.status).toBe("ready");
	});

	it("keeps interaction-backed permission visible without a runtime tool", () => {
		const permission: PermissionRequest = {
			id: "permission-1",
			sessionId: "session-1",
			permission: "Read",
			patterns: [],
			metadata: {},
			always: [],
			tool: {
				messageID: "message-1",
				callID: "tool-1",
			},
		};
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: "plan",
			connectionError: null,
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(makeCanonicalProjection("ready", "waiting_for_user")),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: permission,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.state.pendingInput.kind).toBe("permission");
		if (snapshot.state.pendingInput.kind !== "permission") {
			throw new Error("Expected permission pending input");
		}
		expect(snapshot.state.pendingInput.request).toBe(permission);
		expect(snapshot.currentStreamingToolCall).toBeNull();
	});

	it("keeps interaction-backed computer permission visible without a runtime tool", () => {
		const computerPermission: ComputerPermissionInteraction = {
			id: "computer-permission-1",
			kind: "computer_permission",
			sessionId: "session-1",
			permissionKind: "screen_recording",
			reason: "Screen Recording permission is required.",
			status: "pending",
			canonicalOperationId: "op-1",
		};
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: "plan",
			connectionError: null,
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(makeCanonicalProjection("ready", "waiting_for_user")),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingComputerPermission: computerPermission,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.state.pendingInput.kind).toBe("computer_permission");
		if (snapshot.state.pendingInput.kind !== "computer_permission") {
			throw new Error("Expected computer permission pending input");
		}
		expect(snapshot.state.pendingInput.request).toBe(computerPermission);
		expect(snapshot.workBucket).toBe("answer_needed");
		expect(snapshot.currentStreamingToolCall).toBeNull();
	});

	it("uses graph-backed running activity when no live tool call is available", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: "build",
			connectionError: null,
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(makeCanonicalProjection("ready", "running_operation")),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.isStreaming).toBe(true);
		expect(snapshot.isThinking).toBe(false);
		expect(snapshot.state.activity.kind).toBe("streaming");
		expect(snapshot.status).toBe("streaming");
	});

	it("keeps graph-backed planning visible for reserved sessions", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "cursor",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: null,
			connectionError: null,
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(makeCanonicalProjection("reserved", "awaiting_model")),
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

	it("surfaces canonical connectionError even when runtime stays connected", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: null,
			connectionError: "Resume failed",
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(
				makeCanonicalProjection("failed", "idle", "Resume failed")
			),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.connectionError).toBe("Resume failed");
		expect(snapshot.status).toBe("error");
	});

	it("fails visible when a queue session has no canonical projection", () => {
		const snapshot = buildQueueSessionSnapshot({
			id: "session-1",
			agentId: "opencode",
			projectPath: "/repo",
			title: "Queue item",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: null,
			lastTodoToolCall: null,
			updatedAt: new Date("2026-03-30T12:00:00.000Z"),
			currentModeId: null,
			connectionError: null,
			sequenceId: null,
			activeTurnFailure: null,
			liveSessionSource: makeLiveSource(null),
			interactionSnapshot: {
				pendingQuestion: null,
				pendingPermission: null,
				pendingPlanApproval: null,
			},
			hasUnseenCompletion: false,
		});

		expect(snapshot.currentModeId).toBeNull();
		expect(snapshot.connectionError).toBeNull();
		expect(snapshot.activeTurnFailure).toBeNull();
		expect(snapshot.status).toBe("error");
		expect(snapshot.workBucket).toBe("error");
	});
});

import { describe, expect, it } from "bun:test";

import type { SessionState } from "../../session-state.js";
import { buildThreadBoard, classifyThreadBoardStatus } from "../build-thread-board.js";
import type { ThreadBoardSource } from "../thread-board-item.js";
import { THREAD_BOARD_STATUS_ORDER } from "../thread-board-status.js";

function makeState(
	overrides: Partial<{
		connection: SessionState["connection"];
		activityKind: SessionState["activity"]["kind"];
		modeId: string | null;
		pendingInputKind: SessionState["pendingInput"]["kind"];
		hasUnseenCompletion: boolean;
	}> = {}
): SessionState {
	const {
		connection = "connected",
		activityKind = "idle",
		modeId = null,
		pendingInputKind = "none",
		hasUnseenCompletion = false,
	} = overrides;

	let activity: SessionState["activity"];
	switch (activityKind) {
		case "streaming":
			activity = { kind: "streaming", modeId, tool: null };
			break;
		case "thinking":
			activity = { kind: "thinking" };
			break;
		case "paused":
			activity = { kind: "paused" };
			break;
		default:
			activity = { kind: "idle" };
	}

	let pendingInput: SessionState["pendingInput"];
	switch (pendingInputKind) {
		case "question":
			pendingInput = { kind: "question", request: { id: "q-1", sessionId: "s-1", questions: [] } };
			break;
		case "permission":
			pendingInput = {
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
			break;
		default:
			pendingInput = { kind: "none" };
	}

	return {
		connection,
		activity,
		pendingInput,
		attention: { hasUnseenCompletion },
	};
}

function makeSource(overrides: Partial<ThreadBoardSource> = {}): ThreadBoardSource {
	return {
		panelId: overrides.panelId !== undefined ? overrides.panelId : "panel-1",
		sessionId: overrides.sessionId !== undefined ? overrides.sessionId : "session-1",
		agentId: overrides.agentId !== undefined ? overrides.agentId : "claude",
		projectPath: overrides.projectPath !== undefined ? overrides.projectPath : "/test/project",
		projectName: overrides.projectName !== undefined ? overrides.projectName : "project",
		projectColor: overrides.projectColor !== undefined ? overrides.projectColor : "#ffffff",
		title: overrides.title !== undefined ? overrides.title : "Thread",
		lastActivityAt: overrides.lastActivityAt !== undefined ? overrides.lastActivityAt : 1000,
		currentModeId: overrides.currentModeId !== undefined ? overrides.currentModeId : null,
		currentToolKind: overrides.currentToolKind !== undefined ? overrides.currentToolKind : null,
		currentStreamingToolCall:
			overrides.currentStreamingToolCall !== undefined
				? overrides.currentStreamingToolCall
				: null,
		lastToolKind: overrides.lastToolKind !== undefined ? overrides.lastToolKind : null,
		lastToolCall: overrides.lastToolCall !== undefined ? overrides.lastToolCall : null,
		insertions: overrides.insertions !== undefined ? overrides.insertions : 0,
		deletions: overrides.deletions !== undefined ? overrides.deletions : 0,
		todoProgress: overrides.todoProgress !== undefined ? overrides.todoProgress : null,
		connectionError: overrides.connectionError !== undefined ? overrides.connectionError : null,
		state: overrides.state !== undefined ? overrides.state : makeState(),
	};
}

describe("classifyThreadBoardStatus", () => {
	it("maps a plan-mode streaming thread to planning", () => {
		const source = makeSource({
			currentModeId: "plan",
			state: makeState({ activityKind: "streaming", modeId: "plan" }),
		});

		expect(classifyThreadBoardStatus(source)).toBe("planning");
	});

	it("maps a non-plan active thread to working", () => {
		const source = makeSource({
			currentModeId: "build",
			state: makeState({ activityKind: "thinking" }),
		});

		expect(classifyThreadBoardStatus(source)).toBe("working");
	});

	it("maps pending input to answer_needed even when the thread is active", () => {
		const source = makeSource({
			currentModeId: "plan",
			state: makeState({
				activityKind: "streaming",
				modeId: "plan",
				pendingInputKind: "permission",
			}),
		});

		expect(classifyThreadBoardStatus(source)).toBe("answer_needed");
	});

	it("maps an error thread to error even when it still has unseen completion", () => {
		const source = makeSource({
			connectionError: "Session failed",
			state: makeState({ connection: "error", hasUnseenCompletion: true }),
		});

		expect(classifyThreadBoardStatus(source)).toBe("error");
	});

	it("maps an unseen completed thread to needs_review", () => {
		const source = makeSource({
			state: makeState({ activityKind: "idle", hasUnseenCompletion: true }),
		});

		expect(classifyThreadBoardStatus(source)).toBe("needs_review");
	});

	it("maps a seen completed thread to idle", () => {
		const source = makeSource({
			state: makeState({ activityKind: "idle", hasUnseenCompletion: false }),
		});

		expect(classifyThreadBoardStatus(source)).toBe("idle");
	});

	it("maps a restored thread without an unseen marker to idle", () => {
		const source = makeSource({
			state: makeState({ connection: "disconnected", activityKind: "idle" }),
		});

		expect(classifyThreadBoardStatus(source)).toBe("idle");
	});
});

describe("buildThreadBoard", () => {
	it("emits stable groups in board order", () => {
		const groups = buildThreadBoard([
			makeSource({
				panelId: "panel-answer",
				state: makeState({ pendingInputKind: "question" }),
			}),
			makeSource({
				panelId: "panel-planning",
				currentModeId: "plan",
				state: makeState({ activityKind: "streaming", modeId: "plan" }),
			}),
			makeSource({
				panelId: "panel-working",
				currentModeId: "build",
				state: makeState({ activityKind: "streaming", modeId: "build" }),
			}),
			makeSource({
				panelId: "panel-needs-review",
				state: makeState({ activityKind: "idle", hasUnseenCompletion: true }),
			}),
			makeSource({
				panelId: "panel-idle",
				state: makeState({ hasUnseenCompletion: false }),
			}),
			makeSource({
				panelId: "panel-error",
				connectionError: "Connection error",
				state: makeState({ connection: "error" }),
			}),
		]);

		expect(THREAD_BOARD_STATUS_ORDER).toEqual([
			"answer_needed",
			"planning",
			"working",
			"needs_review",
			"idle",
			"error",
		]);
		expect(groups.map((group) => group.status)).toEqual(Array.from(THREAD_BOARD_STATUS_ORDER));
		expect(groups.find((group) => group.status === "answer_needed")?.items[0]?.panelId).toBe(
			"panel-answer"
		);
		expect(groups.find((group) => group.status === "planning")?.items[0]?.panelId).toBe(
			"panel-planning"
		);
		expect(groups.find((group) => group.status === "working")?.items[0]?.panelId).toBe(
			"panel-working"
		);
		expect(groups.find((group) => group.status === "needs_review")?.items[0]?.panelId).toBe(
			"panel-needs-review"
		);
		expect(groups.find((group) => group.status === "idle")?.items[0]?.panelId).toBe(
			"panel-idle"
		);
		expect(groups.find((group) => group.status === "error")?.items[0]?.panelId).toBe(
			"panel-error"
		);
	});

	it("sorts items within a status by most recent activity first", () => {
		const groups = buildThreadBoard([
			makeSource({
				panelId: "panel-old",
				lastActivityAt: 1000,
				state: makeState({ activityKind: "idle", hasUnseenCompletion: true }),
			}),
			makeSource({
				panelId: "panel-new",
				lastActivityAt: 2000,
				state: makeState({ activityKind: "idle", hasUnseenCompletion: true }),
			}),
		]);

		expect(groups.find((group) => group.status === "needs_review")?.items.map((item) => item.panelId)).toEqual([
			"panel-new",
			"panel-old",
		]);
	});
});
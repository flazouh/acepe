import { describe, expect, it } from "bun:test";

import type { SessionState } from "../../session-state.js";
import { classifyItem, groupIntoSections, isFinishedAttention } from "../queue-section-utils.js";
import type { QueueItem } from "../types.js";

/**
 * Create a default SessionState for testing.
 */
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

function makeItem(
	overrides: Partial<
		Omit<QueueItem, "state"> & {
			state?: SessionState;
			/** Convenience: derive state.pendingInput.kind === "question" */
			hasPendingQuestion?: boolean;
			/** Convenience: derive state.pendingInput.kind === "permission" */
			hasPendingPermission?: boolean;
			/** Convenience: derive state.connection === "error" */
			hasError?: boolean;
			/** Convenience: derive state.activity.kind === "streaming" */
			isStreaming?: boolean;
			/** Convenience: derive state.attention.hasUnseenCompletion */
			hasUnseenCompletion?: boolean;
		}
	> = {}
): QueueItem {
	// Extract convenience flags (not part of QueueItem)
	const {
		hasPendingQuestion,
		hasPendingPermission,
		hasError,
		isStreaming,
		hasUnseenCompletion,
		...rest
	} = overrides;

	const currentModeId = rest.currentModeId ?? null;

	// Compute state if not provided
	const state =
		rest.state ??
		makeState({
			connection: hasError ? "error" : "connected",
			activityKind: isStreaming ? "streaming" : "idle",
			modeId: currentModeId,
			pendingInputKind: hasPendingQuestion
				? "question"
				: hasPendingPermission
					? "permission"
					: "none",
			hasUnseenCompletion: hasUnseenCompletion ?? false,
		});

	const item: QueueItem = {
		sessionId: "s-1",
		panelId: "p-1",
		agentId: "claude",
		projectPath: "/test/project",
		projectName: "project",
		projectColor: "#fff",
		title: "Test",
		urgency: { level: "low", reason: "Idle", timestamp: 1000, detail: null },
		pendingText: null,
		todoProgress: null,
		lastActivityAt: 1000,
		currentToolKind: null,
		currentStreamingToolCall: null,
		lastToolKind: null,
		lastToolCall: null,
		currentModeId: null,
		insertions: 0,
		deletions: 0,
		pendingQuestion: null,
		status: "ready",
		...rest,
		state, // Always use computed or provided state
	};
	return item;
}

describe("classifyItem", () => {
	it("should treat ready + unseen as finished attention", () => {
		expect(
			isFinishedAttention({
				status: "ready",
				state: makeState({ hasUnseenCompletion: true }),
			})
		).toBe(true);
	});

	it("should not treat ready without unseen as finished attention", () => {
		expect(
			isFinishedAttention({
				status: "ready",
				state: makeState({ hasUnseenCompletion: false }),
			})
		).toBe(false);
	});

	it("should classify pending question as answer_needed", () => {
		expect(classifyItem(makeItem({ hasPendingQuestion: true }))).toBe("answer_needed");
	});

	it("should classify pending permission as answer_needed", () => {
		expect(classifyItem(makeItem({ hasPendingPermission: true }))).toBe("answer_needed");
	});

	it("should classify error status as error", () => {
		expect(classifyItem(makeItem({ hasError: true, status: "error" }))).toBe("error");
	});

	it("should classify streaming without plan mode as working", () => {
		expect(
			classifyItem(makeItem({ status: "streaming", isStreaming: true, currentModeId: "code" }))
		).toBe("working");
	});

	it("should classify streaming with plan mode as working", () => {
		expect(
			classifyItem(makeItem({ status: "streaming", isStreaming: true, currentModeId: "plan" }))
		).toBe("working");
	});

	it("should classify streaming with null mode as working", () => {
		expect(
			classifyItem(makeItem({ status: "streaming", isStreaming: true, currentModeId: null }))
		).toBe("working");
	});

	it("should classify ready status as finished", () => {
		expect(classifyItem(makeItem({ status: "ready", hasUnseenCompletion: true }))).toBe("finished");
	});

	it("should prioritize answer_needed over error", () => {
		expect(
			classifyItem(makeItem({ hasPendingQuestion: true, hasError: true, status: "error" }))
		).toBe("answer_needed");
	});

	it("should prioritize streaming over error (active work takes precedence)", () => {
		expect(classifyItem(makeItem({ hasError: true, status: "error", isStreaming: true }))).toBe(
			"working"
		);
	});

	it("should classify streaming with pending question as answer_needed", () => {
		// Pending input takes priority over streaming — the SSE connection stays
		// open while the agent waits for permission/question responses.
		const item = makeItem({
			state: makeState({
				activityKind: "streaming",
				pendingInputKind: "question",
			}),
		});
		expect(classifyItem(item)).toBe("answer_needed");
	});

	it("should classify streaming with pending permission as answer_needed", () => {
		const item = makeItem({
			state: makeState({
				activityKind: "streaming",
				pendingInputKind: "permission",
			}),
		});
		expect(classifyItem(item)).toBe("answer_needed");
	});

	it("should classify idle with pending question as answer_needed", () => {
		const item = makeItem({
			state: makeState({
				activityKind: "idle",
				pendingInputKind: "question",
			}),
		});
		expect(classifyItem(item)).toBe("answer_needed");
	});
});

describe("groupIntoSections", () => {
	it("should return empty array for empty input", () => {
		expect(groupIntoSections([])).toEqual([]);
	});

	it("should group items into correct sections", () => {
		const items = [
			makeItem({ sessionId: "s-1", hasPendingQuestion: true, lastActivityAt: 100 }),
			makeItem({
				sessionId: "s-2",
				status: "streaming",
				isStreaming: true,
				currentModeId: "code",
				lastActivityAt: 200,
			}),
			makeItem({
				sessionId: "s-3",
				status: "ready",
				hasUnseenCompletion: true,
				lastActivityAt: 300,
			}),
			makeItem({ sessionId: "s-4", hasError: true, status: "error", lastActivityAt: 400 }),
		];

		const sections = groupIntoSections(items);

		expect(sections).toHaveLength(4);
		expect(sections[0].id).toBe("answer_needed");
		expect(sections[0].items).toHaveLength(1);
		expect(sections[1].id).toBe("working");
		expect(sections[1].items).toHaveLength(1);
		expect(sections[2].id).toBe("finished");
		expect(sections[2].items).toHaveLength(1);
		expect(sections[3].id).toBe("error");
		expect(sections[3].items).toHaveLength(1);
	});

	it("should omit empty sections", () => {
		const items = [
			makeItem({
				sessionId: "s-1",
				status: "ready",
				hasUnseenCompletion: true,
				lastActivityAt: 100,
			}),
			makeItem({
				sessionId: "s-2",
				status: "ready",
				hasUnseenCompletion: true,
				lastActivityAt: 200,
			}),
		];

		const sections = groupIntoSections(items);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe("finished");
		expect(sections[0].items).toHaveLength(2);
	});

	it("should preserve section display order", () => {
		const items = [
			makeItem({ sessionId: "s-1", hasError: true, status: "error", lastActivityAt: 100 }),
			makeItem({ sessionId: "s-2", hasPendingQuestion: true, lastActivityAt: 200 }),
		];

		const sections = groupIntoSections(items);
		// answer_needed should come before error in display order
		expect(sections[0].id).toBe("answer_needed");
		expect(sections[1].id).toBe("error");
	});

	it("should sort items within sections by lastActivityAt descending", () => {
		const items = [
			makeItem({
				sessionId: "s-1",
				status: "ready",
				hasUnseenCompletion: true,
				lastActivityAt: 100,
			}),
			makeItem({
				sessionId: "s-2",
				status: "ready",
				hasUnseenCompletion: true,
				lastActivityAt: 300,
			}),
			makeItem({
				sessionId: "s-3",
				status: "ready",
				hasUnseenCompletion: true,
				lastActivityAt: 200,
			}),
		];

		const sections = groupIntoSections(items);
		expect(sections[0].items[0].sessionId).toBe("s-2"); // 300 (most recent)
		expect(sections[0].items[1].sessionId).toBe("s-3"); // 200
		expect(sections[0].items[2].sessionId).toBe("s-1"); // 100 (oldest)
	});

	it("should group planning items together with working", () => {
		const items = [
			makeItem({
				sessionId: "s-1",
				status: "streaming",
				isStreaming: true,
				currentModeId: "code",
				lastActivityAt: 100,
			}),
			makeItem({
				sessionId: "s-2",
				status: "streaming",
				isStreaming: true,
				currentModeId: "plan",
				lastActivityAt: 200,
			}),
		];

		const sections = groupIntoSections(items);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe("working");
		expect(sections[0].items).toHaveLength(2);
	});
});

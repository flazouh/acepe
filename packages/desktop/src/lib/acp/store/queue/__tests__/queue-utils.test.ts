import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { SessionStatus } from "../../../application/dto/session-status.js";
import type { ToolCall } from "../../../types/tool-call.js";
import type { UrgencyInfo } from "../../urgency.js";
import { classifyItem } from "../queue-section-utils.js";
import { buildQueueItem, type QueueSessionSnapshot } from "../utils.js";

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
	return {
		id: "session-1",
		agentId: "opencode",
		projectPath: "/repo",
		title: "Queue item",
		entries: [],
		isStreaming: false,
		isThinking: false,
		status: "ready",
		updatedAt: new Date("2026-03-30T12:00:00.000Z"),
		currentModeId: "code",
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
});

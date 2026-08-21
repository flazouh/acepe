import { describe, expect, it } from "bun:test";
import { ActivityId, SessionId, ToolCallId } from "@acepe/contracts";

import { toolRowFromActivityProjection } from "./agent-panel-tool-row.ts";

const sessionId = SessionId.make("session-1");

describe("toolRowFromActivityProjection", () => {
	it("maps a tool activity to a tool row while the operation link is still pending", () => {
		const entry = toolRowFromActivityProjection({
			activityId: ActivityId.make("event-tool-1"),
			sessionId,
			sequence: 6,
			statusSequence: 6,
			kind: "tool",
			toolCallId: ToolCallId.make("call-1"),
			operationId: null,
			status: "in_progress",
			title: "Read AGENTS.md",
			path: null,
		});

		expect(entry).toEqual({
			id: "event-tool-1",
			type: "tool_call",
			toolCallId: "call-1",
			kind: "unclassified",
			title: "Read AGENTS.md",
			status: "running",
			presentationState: "pending_operation",
		});
	});

	it("maps a file activity with a linked operation to a resolved tool row", () => {
		const entry = toolRowFromActivityProjection({
			activityId: ActivityId.make("event-file-1"),
			sessionId,
			sequence: 7,
			statusSequence: 9,
			kind: "file",
			toolCallId: ToolCallId.make("call-2"),
			operationId: "operation-2",
			status: "completed",
			title: "Edit",
			path: "src/lib/panel.ts",
		});

		expect(entry).toEqual({
			id: "event-file-1",
			type: "tool_call",
			toolCallId: "call-2",
			operationId: "operation-2",
			kind: "unclassified",
			title: "Edit",
			filePath: "src/lib/panel.ts",
			status: "done",
			presentationState: "resolved",
		});
	});

	it("maps failed and pending statuses without inventing progress", () => {
		const failed = toolRowFromActivityProjection({
			activityId: ActivityId.make("event-tool-fail"),
			sessionId,
			sequence: 11,
			statusSequence: 11,
			kind: "tool",
			toolCallId: null,
			operationId: null,
			status: "failed",
			title: "Search",
			path: null,
		});
		const pending = toolRowFromActivityProjection({
			activityId: ActivityId.make("event-tool-pending"),
			sessionId,
			sequence: 4,
			statusSequence: 4,
			kind: "tool",
			toolCallId: null,
			operationId: null,
			status: "pending",
			title: "activity",
			path: null,
		});

		expect(failed.status).toBe("error");
		expect(pending.status).toBe("pending");
	});
});

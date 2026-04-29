import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../../../application/dto/session.js";
import type { ToolCall } from "../../../../types/tool-call.js";
import { shouldUseOptimisticDesktopToolRenderer } from "../tool-renderer-routing.js";

function createToolCallEntry(
	id: string,
	message: ToolCall
): Extract<SessionEntry, { type: "tool_call" }> {
	return {
		id,
		type: "tool_call",
		message,
	};
}

describe("shouldUseOptimisticDesktopToolRenderer", () => {
	it("keeps transcript-derived generic tool calls on the desktop renderer path before canonical scene entries exist", () => {
		const entry = createToolCallEntry("tool-generic-1", {
			id: "tool-generic-1",
			name: "List assets and packages",
			kind: "other",
			status: "completed",
			title: "List assets and packages",
			arguments: { kind: "other", raw: null },
			result: null,
			awaitingPlanApproval: false,
		});

		expect(shouldUseOptimisticDesktopToolRenderer(entry, false)).toBe(true);
	});

	it("routes structured tool calls away from the desktop renderer once canonical scene entries exist", () => {
		const entry = createToolCallEntry("tool-execute-1", {
			id: "tool-execute-1",
			name: "execute",
			kind: "execute",
			status: "completed",
			title: "Run command",
			arguments: { kind: "execute", command: "ls" },
			result: "ok",
			awaitingPlanApproval: false,
		});

		expect(shouldUseOptimisticDesktopToolRenderer(entry, true)).toBe(false);
	});
});

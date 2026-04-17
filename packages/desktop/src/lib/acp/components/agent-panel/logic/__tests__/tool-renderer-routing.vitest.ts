import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../../../application/dto/session.js";
import { shouldUseDesktopToolRenderer } from "../tool-renderer-routing.js";

function createToolCallEntry(
	id: string,
	message: SessionEntry & { type: "tool_call" }["message"]
): Extract<SessionEntry, { type: "tool_call" }> {
	return {
		id,
		type: "tool_call",
		message,
	};
}

describe("shouldUseDesktopToolRenderer", () => {
	it("keeps transcript-derived generic tool calls on the desktop renderer path", () => {
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

		expect(shouldUseDesktopToolRenderer(entry)).toBe(true);
	});

	it("keeps structured tool calls on the desktop renderer path too", () => {
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

		expect(shouldUseDesktopToolRenderer(entry)).toBe(true);
	});
});

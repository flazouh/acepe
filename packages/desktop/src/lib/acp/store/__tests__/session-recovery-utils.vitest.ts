import { describe, expect, it } from "vitest";

import { shouldMarkSessionInterrupted } from "../session-recovery-utils.js";

function createToolCallEntry(
	toolCallId: string,
	status: "pending" | "in_progress" | "completed" | "failed"
) {
	return {
		id: `entry-${toolCallId}`,
		type: "tool_call" as const,
		message: {
			id: toolCallId,
			name: "TestTool",
			arguments: { kind: "execute" as const, command: "echo" },
			status,
			awaitingPlanApproval: false,
		},
	};
}

describe("session-recovery-utils", () => {
	describe("shouldMarkSessionInterrupted", () => {
		it("returns false when turnState is streaming", () => {
			const entries = [createToolCallEntry("tc-1", "in_progress")] as Parameters<
				typeof shouldMarkSessionInterrupted
			>[0];
			expect(shouldMarkSessionInterrupted(entries, "streaming")).toBe(false);
		});

		it("returns false when turnState is completed", () => {
			const entries = [createToolCallEntry("tc-1", "in_progress")] as Parameters<
				typeof shouldMarkSessionInterrupted
			>[0];
			expect(shouldMarkSessionInterrupted(entries, "completed")).toBe(false);
		});

		it("returns false when turnState is interrupted (already handled)", () => {
			const entries = [createToolCallEntry("tc-1", "in_progress")] as Parameters<
				typeof shouldMarkSessionInterrupted
			>[0];
			expect(shouldMarkSessionInterrupted(entries, "interrupted")).toBe(false);
		});

		it("returns true when turnState is idle and tool is in_progress", () => {
			const entries = [createToolCallEntry("tc-1", "in_progress")] as Parameters<
				typeof shouldMarkSessionInterrupted
			>[0];
			expect(shouldMarkSessionInterrupted(entries, "idle")).toBe(true);
		});

		it("returns true when turnState is idle and tool is pending", () => {
			const entries = [createToolCallEntry("tc-1", "pending")] as Parameters<
				typeof shouldMarkSessionInterrupted
			>[0];
			expect(shouldMarkSessionInterrupted(entries, "idle")).toBe(true);
		});

		it("returns false when turnState is idle and all tools are completed", () => {
			const entries = [createToolCallEntry("tc-1", "completed")] as Parameters<
				typeof shouldMarkSessionInterrupted
			>[0];
			expect(shouldMarkSessionInterrupted(entries, "idle")).toBe(false);
		});

		it("returns false when entries is empty", () => {
			expect(shouldMarkSessionInterrupted([], "idle")).toBe(false);
		});

		it("returns false when entries is undefined", () => {
			expect(shouldMarkSessionInterrupted(undefined, "idle")).toBe(false);
		});

		it("returns false when entries is null", () => {
			expect(shouldMarkSessionInterrupted(null, "idle")).toBe(false);
		});

		it("ignores non-tool-call entries", () => {
			const entries = [
				{
					id: "user-1",
					type: "user" as const,
					message: {
						content: { type: "text" as const, text: "hi" },
						chunks: [{ type: "text" as const, text: "hi" }],
					},
				},
			] as Parameters<typeof shouldMarkSessionInterrupted>[0];
			expect(shouldMarkSessionInterrupted(entries, "idle")).toBe(false);
		});

		it("checks taskChildren recursively for pending status", () => {
			const parent = createToolCallEntry("parent", "completed");
			(parent.message as { taskChildren?: unknown[] }).taskChildren = [
				createToolCallEntry("child", "in_progress").message,
			];
			const entries = [parent];
			expect(shouldMarkSessionInterrupted(entries, "idle")).toBe(true);
		});
	});
});

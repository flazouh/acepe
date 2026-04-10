import { describe, expect, it } from "bun:test";

import type { ToolCall } from "$lib/acp/types/tool-call.js";

import {
	resolveCompactToolDisplay,
	resolveFullToolEntry,
} from "../tool-definition-registry.js";

function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
	const base: ToolCall = {
		id: "tool-1",
		name: "Read",
		kind: "read",
		arguments: { kind: "read", file_path: "/repo/src/app.ts" },
		status: "in_progress",
		result: null,
		title: null,
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		parentToolUseId: null,
		taskChildren: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
		startedAtMs: 1,
		completedAtMs: undefined,
	};

	if (!overrides) {
		return base;
	}

	return Object.assign({}, base, overrides);
}

describe("tool definition display builders", () => {
	it("builds a shared row entry for file tools", () => {
		const entry = resolveFullToolEntry({
			toolCall: createToolCall(),
			turnState: "streaming",
		});

		expect(entry).toEqual({
			id: "tool-1",
			type: "tool_call",
			kind: "read",
			title: "Reading",
			subtitle: "/repo/src/app.ts",
			filePath: "/repo/src/app.ts",
			status: "running",
		});
	});

	it("builds a compact row display for command tools without falling back to the generic verb", () => {
		const compactDisplay = resolveCompactToolDisplay({
			toolCall: createToolCall({
				id: "tool-2",
				name: "Bash",
				kind: "execute",
				arguments: { kind: "execute", command: "git status --short" },
			}),
			turnState: "streaming",
		});

		expect(compactDisplay).toEqual({
			id: "tool-2",
			kind: "execute",
			title: "git status --short",
			filePath: undefined,
			status: "running",
		});
	});

	it("builds execute entries with parsed command output for the shared agent panel", () => {
		const entry = resolveFullToolEntry({
			toolCall: createToolCall({
				id: "tool-4",
				name: "Bash",
				kind: "execute",
				status: "completed",
				arguments: { kind: "execute", command: "ls -la hello-go/" },
				result: [
					"Chunk ID: f8d993",
					"Wall time: 0.0523 seconds",
					"Process exited with code 0",
					"Original token count: 3",
					"Output:",
					"total 8",
					"main.go",
					"go.mod",
				].join("\n"),
			}),
			turnState: "completed",
		});

		expect(entry).toEqual({
			id: "tool-4",
			type: "tool_call",
			kind: "execute",
			title: "Ran command",
			subtitle: "ls -la hello-go/",
			filePath: undefined,
			status: "done",
			command: "ls -la hello-go/",
			stdout: "total 8\nmain.go\ngo.mod",
			stderr: null,
			exitCode: 0,
		});
	});

	it("builds execute entries from MCP content block array results", () => {
		const entry = resolveFullToolEntry({
			toolCall: createToolCall({
				id: "tool-7",
				name: "Bash",
				kind: "execute",
				status: "completed",
				arguments: { kind: "execute", command: "bun test" },
				result: [
					{ type: "text", text: "3 tests passed" },
					{ type: "text", text: "Done" },
				],
			}),
			turnState: "completed",
		});

		expect(entry).toEqual({
			id: "tool-7",
			type: "tool_call",
			kind: "execute",
			title: "Ran command",
			subtitle: "bun test",
			filePath: undefined,
			status: "done",
			command: "bun test",
			stdout: "3 tests passed\nDone",
			stderr: null,
			exitCode: undefined,
		});
	});

	it("marks unfinished child tools as done when the parent task has completed", () => {
		const entry = resolveFullToolEntry({
			toolCall: createToolCall({
				id: "tool-3",
				status: "in_progress",
			}),
			turnState: "completed",
			parentCompleted: true,
		});

		expect(entry.status).toBe("done");
	});

	it("prefers the semantic delete title over raw apply_patch titles for delete entries", () => {
		const entry = resolveFullToolEntry({
			toolCall: createToolCall({
				id: "tool-5",
				name: "apply_patch",
				kind: "delete",
				status: "completed",
				title: "apply_patch",
				arguments: { kind: "delete", file_path: "/repo/README.md" },
			}),
			turnState: "completed",
		});

		expect(entry.title).toBe("Deleted");
		expect(entry.filePath).toBe("/repo/README.md");
	});

	it("builds compact multi-delete displays from the delete subtitle when no single file path is available", () => {
		const compactDisplay = resolveCompactToolDisplay({
			toolCall: createToolCall({
				id: "tool-6",
				name: "apply_patch",
				kind: "delete",
				status: "completed",
				title: "apply_patch",
				arguments: {
					kind: "delete",
					file_path: "/repo/old-a.md",
					file_paths: ["/repo/old-a.md", "/repo/old-b.md"],
				},
			}),
			turnState: "completed",
		});

		expect(compactDisplay).toEqual({
			id: "tool-6",
			kind: "delete",
			title: "old-a.md +1",
			filePath: undefined,
			status: "done",
		});
	});
});

import { describe, expect, it } from "bun:test";

import type { ToolCall } from "$lib/acp/types/tool-call.js";
import type { OperationFamily } from "$lib/services/converted-session-types.js";

import {
	getToolDefinition,
	resolveCompactToolDisplay,
	resolveFullToolEntry,
} from "../tool-definition-registry.js";

function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
	const base: ToolCall = {
		id: "tool-1",
		name: "Bash",
		kind: "execute",
		arguments: { kind: "execute", command: "git status --short" },
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

describe("tool definition registry", () => {
	it("preserves exported operation family contracts alongside tool-call display kinds", () => {
		const family: OperationFamily = "todo_write";

		expect(family).toBe("todo_write");
	});

	it("resolves the detail renderer and compact display from the same definition", () => {
		const toolCall = createToolCall();
		const definition = getToolDefinition(toolCall);

		expect(definition.rendererKey).toBe("execute");
		expect(definition).toHaveProperty("component");
		expect(resolveCompactToolDisplay({ toolCall, turnState: "streaming" })).toEqual({
			id: "tool-1",
			kind: "execute",
			title: "git status --short",
			filePath: undefined,
			status: "running",
		});
		expect(resolveFullToolEntry({ toolCall, turnState: "streaming" })).toEqual({
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Running command",
			subtitle: "git status --short",
			filePath: undefined,
			status: "running",
			command: "git status --short",
			stdout: null,
			stderr: null,
			exitCode: undefined,
		});
	});

	it("uses the same registry for route aliases like read_lints", () => {
		const definition = getToolDefinition(
			createToolCall({
				id: "tool-2",
				name: "read_lints",
				kind: "read",
				title: "Read Lints",
				arguments: { kind: "read", file_path: "/tmp/lints.txt" },
			})
		);

		expect(definition.rendererKey).toBe("read_lints");
		expect(definition).toHaveProperty("component");
	});
});

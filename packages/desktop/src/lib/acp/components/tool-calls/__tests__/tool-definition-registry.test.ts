import { describe, expect, it } from "bun:test";

import type { ToolCall } from "$lib/acp/types/tool-call.js";

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

	it("builds browser entries with script and result details for shared previews", () => {
		const toolCall = createToolCall({
			id: "tool-browser-1",
			name: "mcp__tauri__webview_execute_js",
			kind: "browser",
			status: "completed",
			arguments: {
				kind: "browser",
				raw: {
					script: "(() => document.title)()",
				},
			},
			result: {
				content: "\"Wrong raw payload\"",
			},
			normalizedResult: {
				kind: "browser",
				content: "\"Acepe\"",
				detailedContent: null,
				screenshotUrl: null,
				outcome: "success",
			},
		});

		expect(resolveFullToolEntry({ toolCall, turnState: "completed" })).toEqual({
			id: "tool-browser-1",
			type: "tool_call",
			kind: "browser",
			title: "Execute JS",
			subtitle: "(() => document.title)()",
			filePath: undefined,
			status: "done",
			detailsText: "\"Acepe\"",
			scriptText: "(() => document.title)()",
		});
	});
});

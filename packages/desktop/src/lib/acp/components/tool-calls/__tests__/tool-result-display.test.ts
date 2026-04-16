import { describe, expect, it } from "bun:test";

import type { ToolCall } from "$lib/acp/types/tool-call.js";

import {
	resolveExecuteDisplayResult,
	resolveExecuteFallbackOutputText,
	resolveFetchResultText,
	resolveSearchDisplayResult,
	resolveWebSearchDisplayResult,
} from "../tool-result-display.js";

function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
	const base: ToolCall = {
		id: "tool-1",
		name: "tool",
		kind: "execute",
		arguments: { kind: "execute", command: "pwd" },
		status: "completed",
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
	};

	if (!overrides) {
		return base;
	}

	return Object.assign({}, base, overrides);
}

describe("tool result display helpers", () => {
	it("prefers normalized execute results over conflicting raw payloads", () => {
		const toolCall = createToolCall({
			result: "raw transport output",
			normalizedResult: {
				kind: "execute",
				stdout: "/repo",
				stderr: null,
				exitCode: 0,
			},
		});

		expect(resolveExecuteDisplayResult(toolCall)).toEqual({
			stdout: "/repo",
			stderr: null,
			exitCode: 0,
		});
		expect(resolveExecuteFallbackOutputText(toolCall)).toBeNull();
	});

	it("falls back to raw execute parsing when normalization is absent", () => {
		const toolCall = createToolCall({
			result: "Process exited with code 0\nOutput:\nhello",
		});

		expect(resolveExecuteDisplayResult(toolCall)).toEqual({
			stdout: "hello",
			stderr: null,
			exitCode: 0,
		});
		expect(resolveExecuteFallbackOutputText(toolCall)).toBe("hello");
	});

	it("prefers normalized search results over conflicting raw payloads", () => {
		const toolCall = createToolCall({
			kind: "search",
			arguments: { kind: "search", query: "jwt", file_path: "src/lib/auth.ts" },
			result: {
				mode: "files_with_matches",
				filenames: ["wrong.ts"],
			},
			normalizedResult: {
				kind: "search",
				mode: "files",
				numFiles: 2,
				matches: [],
				files: ["src/lib/auth.ts", "src/routes/login.ts"],
			},
		});

		expect(resolveSearchDisplayResult(toolCall, "src/lib/auth.ts")).toEqual({
			mode: "files",
			numFiles: 2,
			numMatches: undefined,
			matches: [],
			files: ["src/lib/auth.ts", "src/routes/login.ts"],
		});
	});

	it("prefers normalized fetch results over conflicting raw payloads", () => {
		const toolCall = createToolCall({
			kind: "fetch",
			arguments: { kind: "fetch", url: "https://acepe.dev/docs" },
			result: {
				responseBody: "wrong body",
			},
			normalizedResult: {
				kind: "fetch",
				responseBody: "Fetched docs body",
				statusCode: 200,
				headers: [],
				contentType: null,
			},
		});

		expect(resolveFetchResultText(toolCall)).toBe("Fetched docs body");
	});

	it("prefers normalized web search results over conflicting raw payloads", () => {
		const toolCall = createToolCall({
			kind: "web_search",
			arguments: { kind: "webSearch", query: "acepe agent panel" },
			result: {
				summary: "Wrong raw summary",
				search_results: [{ title: "Wrong", url: "https://wrong.dev" }],
			},
			normalizedResult: {
				kind: "web_search",
				summary: "Found references",
				links: [{ title: "Acepe", url: "https://acepe.dev", domain: "acepe.dev" }],
			},
		});

		expect(resolveWebSearchDisplayResult(toolCall)).toEqual({
			summary: "Found references",
			links: [{ title: "Acepe", url: "https://acepe.dev", domain: "acepe.dev" }],
		});
	});
});

import { describe, expect, it } from "bun:test";

import { normalizeToolResult } from "../tool-result-normalizer.js";

describe("normalizeToolResult", () => {
	it("normalizes execute results from detailed content envelopes", () => {
		const normalized = normalizeToolResult({
			kind: "execute",
			arguments: { kind: "execute", command: "pwd" },
			result: {
				content: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
				detailedContent: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
			},
		});

		expect(normalized).toEqual({
			kind: "execute",
			stdout: "/Users/alex/Documents/acepe",
			stderr: null,
			exitCode: 0,
		});
	});

	it("normalizes search metadata from canonical result payloads", () => {
		const normalized = normalizeToolResult({
			kind: "search",
			arguments: { kind: "search", query: "jwt", file_path: "src/lib/auth.ts" },
			result: {
				mode: "files_with_matches",
				filenames: ["src/lib/auth.ts", "src/routes/login.ts"],
			},
		});

		expect(normalized).toEqual({
			kind: "search",
			mode: "files",
			numFiles: 2,
			numMatches: undefined,
			matches: [],
			files: ["src/lib/auth.ts", "src/routes/login.ts"],
		});
	});

	it("normalizes structured fetch results", () => {
		const normalized = normalizeToolResult({
			kind: "fetch",
			arguments: { kind: "fetch", url: "https://acepe.dev" },
			result: {
				statusCode: 200,
				responseBody: "Fetched docs body",
				headers: {
					"content-type": "text/plain",
				},
			},
		});

		expect(normalized).toEqual({
			kind: "fetch",
			responseBody: "Fetched docs body",
			statusCode: 200,
			headers: [{ name: "content-type", value: "text/plain" }],
			contentType: "text/plain",
		});
	});

	it("normalizes web search results into a shared contract", () => {
		const normalized = normalizeToolResult({
			kind: "web_search",
			arguments: { kind: "webSearch", query: "acepe" },
			result: {
				summary: "Found references",
				search_results: [{ title: "Acepe", url: "https://acepe.dev" }],
			},
		});

		expect(normalized).toEqual({
			kind: "web_search",
			summary: "Found references",
			links: [{ title: "Acepe", url: "https://acepe.dev", domain: "acepe.dev" }],
		});
	});

	it("normalizes browser results without baking in component props", () => {
		const normalized = normalizeToolResult({
			kind: "browser",
			arguments: {
				kind: "browser",
				raw: {
					script: "(() => document.title)()",
				},
			},
			result: {
				content: '"Acepe"',
				screenshotUrl: "file:///tmp/acepe.png",
				success: true,
			},
		});

		expect(normalized).toEqual({
			kind: "browser",
			content: '"Acepe"',
			detailedContent: null,
			screenshotUrl: "file:///tmp/acepe.png",
			outcome: "success",
		});
	});

	it("normalizes sql results into an explicit shared contract", () => {
		const normalized = normalizeToolResult({
			kind: "sql",
			arguments: {
				kind: "sql",
				query: "SELECT * FROM todos",
				description: "Load todos",
			},
			result: {
				rows: [{ id: 1, content: "Ship reconciler" }],
			},
		});

		expect(normalized).toEqual({
			kind: "sql",
			rawText: JSON.stringify(
				{
					rows: [{ id: 1, content: "Ship reconciler" }],
				},
				null,
				2
			),
			rowCount: 1,
		});
	});

	it("returns null for empty results", () => {
		expect(
			normalizeToolResult({
				kind: "fetch",
				arguments: { kind: "fetch", url: "https://acepe.dev" },
				result: "",
			})
		).toBeNull();
	});
});

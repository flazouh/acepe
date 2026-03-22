import { describe, expect, it } from "bun:test";

import { getOpenInFinderTarget } from "../open-in-finder-target";

describe("getOpenInFinderTarget", () => {
	it("prefers sourcePath when available", () => {
		const target = getOpenInFinderTarget({
			sessionId: "session-123",
			projectPath: "/projects/acepe",
			agentId: "claude-code",
			sourcePath: "/cursor/transcripts/session-123.json",
		});

		expect(target).toEqual({
			kind: "reveal",
			path: "/cursor/transcripts/session-123.json",
		});
	});

	it("uses claude open-in-finder when agent is claude-code and no sourcePath", () => {
		const target = getOpenInFinderTarget({
			sessionId: "session-123",
			projectPath: "/projects/acepe",
			agentId: "claude-code",
			sourcePath: null,
		});

		expect(target).toEqual({
			kind: "claude",
			sessionId: "session-123",
			projectPath: "/projects/acepe",
		});
	});

	it("reveals project folder for non-claude agents without sourcePath", () => {
		const target = getOpenInFinderTarget({
			sessionId: "session-123",
			projectPath: "/projects/acepe",
			agentId: "cursor",
			sourcePath: undefined,
		});

		expect(target).toEqual({
			kind: "reveal",
			path: "/projects/acepe",
		});
	});

	it("returns null when required data is missing", () => {
		const target = getOpenInFinderTarget({
			sessionId: "",
			projectPath: "",
			agentId: "claude-code",
			sourcePath: null,
		});

		expect(target).toBeNull();
	});
});

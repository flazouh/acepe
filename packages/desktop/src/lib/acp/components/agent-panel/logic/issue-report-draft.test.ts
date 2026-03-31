import { describe, expect, it } from "bun:test";

import { buildAgentErrorIssueDraft } from "./issue-report-draft.js";

describe("buildAgentErrorIssueDraft", () => {
	it("formats a bug report with required fields as a markdown table", () => {
		const draft = buildAgentErrorIssueDraft({
			agentId: "claude-code",
			sessionId: "session-123",
			projectPath: "/Users/example/Documents/acepe",
			worktreePath: "/Users/example/.acepe/worktrees/feature-a",
			errorSummary: "Resume session timed out",
			errorDetails: "ERROR stack line 1\nstack line 2",
		});

		expect(draft.category).toBe("bug");
		expect(draft.title).toContain("Resume session timed out");
		expect(draft.body).toContain("`claude-code`");
		expect(draft.body).toContain("`session-123`");
		expect(draft.body).toContain("`/Users/example/Documents/acepe`");
		expect(draft.body).toContain("`/Users/example/.acepe/worktrees/feature-a`");
		expect(draft.body).toContain("```text\nERROR stack line 1\nstack line 2\n```");
	});

	it("includes optional fields when provided", () => {
		const createdAt = new Date("2026-01-15T10:00:00Z");
		const draft = buildAgentErrorIssueDraft({
			agentId: "claude-code",
			sessionId: "session-123",
			projectPath: "/project",
			worktreePath: null,
			errorSummary: "Connection failed",
			errorDetails: "error details",
			sessionTitle: "My debug session",
			currentModelId: "claude-sonnet-4-6",
			entryCount: 42,
			panelConnectionState: "ERROR",
			sessionCreatedAt: createdAt,
		});

		expect(draft.body).toContain("My debug session");
		expect(draft.body).toContain("`claude-sonnet-4-6`");
		expect(draft.body).toContain("42");
		expect(draft.body).toContain("`ERROR`");
		expect(draft.body).toContain("2026-01-15T10:00:00.000Z");
	});
});

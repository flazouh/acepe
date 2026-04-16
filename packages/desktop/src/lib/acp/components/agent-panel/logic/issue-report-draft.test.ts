import { describe, expect, it } from "vitest";

import { buildAgentErrorIssueDraft } from "./issue-report-draft.js";

describe("buildAgentErrorIssueDraft", () => {
	it("includes incident metadata in the draft body", () => {
		const draft = buildAgentErrorIssueDraft({
			agentId: "claude-code",
			sessionId: "session-123",
			projectPath: "/repo",
			worktreePath: "/repo/.worktrees/feature",
			errorSummary: "Resume failed",
			errorDetails: "stack line 1\nstack line 2",
			referenceId: "ref-123",
			referenceSearchable: true,
			currentModelId: "sonnet",
			entryCount: 12,
			panelConnectionState: "error",
		});

		expect(draft.title).toBe("[claude-code] Resume failed");
		expect(draft.body).toContain("| Surface | agent-panel |");
		expect(draft.body).toContain("| Reference ID | ref-123 |");
		expect(draft.body).toContain("| Reference visibility | searchable in Sentry |");
		expect(draft.body).toContain("| Agent | claude-code |");
		expect(draft.body).toContain("| Model | sonnet |");
		expect(draft.body).toContain("| Message Count | 12 |");
		expect(draft.body).toContain("stack line 1");
	});

	it("omits optional issue metadata when not present", () => {
		const draft = buildAgentErrorIssueDraft({
			agentId: "copilot",
			sessionId: null,
			projectPath: null,
			worktreePath: null,
			errorSummary: "Connection failed",
			errorDetails: "timed out",
		});

		expect(draft.referenceId).toBeNull();
		expect(draft.issueNumber).toBeNull();
		expect(draft.issueUrl).toBeNull();
		expect(draft.body).not.toContain("Existing issue");
	});
});

import { describe, expect, it } from "bun:test";

import { shouldShowClaudeWorkingSpark } from "./claude-working-spark-visibility.js";

describe("shouldShowClaudeWorkingSpark", () => {
	it("shows for Claude when projected streaming is active", () => {
		expect(
			shouldShowClaudeWorkingSpark({
				agentId: "claude-code",
				projectedIsStreaming: true,
				activityIsStreaming: false,
			})
		).toBe(true);
	});

	it("shows for Claude when session activity is streaming", () => {
		expect(
			shouldShowClaudeWorkingSpark({
				agentId: "claude-code",
				projectedIsStreaming: false,
				activityIsStreaming: true,
			})
		).toBe(true);
	});

	it("keeps idle Claude sessions on the regular icon", () => {
		expect(
			shouldShowClaudeWorkingSpark({
				agentId: "claude-code",
				projectedIsStreaming: false,
				activityIsStreaming: false,
			})
		).toBe(false);
	});

	it("keeps non-Claude streaming sessions on the regular icon", () => {
		expect(
			shouldShowClaudeWorkingSpark({
				agentId: "codex",
				projectedIsStreaming: true,
				activityIsStreaming: true,
			})
		).toBe(false);
	});
});

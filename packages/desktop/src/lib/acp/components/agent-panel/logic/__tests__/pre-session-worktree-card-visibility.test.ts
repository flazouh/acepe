import { describe, expect, it } from "vitest";

import { shouldShowPreSessionWorktreeCard } from "../pre-session-worktree-card-visibility.js";

function baseInput() {
	return {
		sessionId: null,
		pendingProjectSelection: false,
		worktreeToggleProjectPath: "/repo",
		hasPendingWorktreeSetup: false,
		worktreeSetupVisible: false,
		hasMessages: false,
	};
}

describe("shouldShowPreSessionWorktreeCard", () => {
	it("shows before a session is attached when the panel is still empty", () => {
		expect(shouldShowPreSessionWorktreeCard(baseInput())).toBe(true);
	});

	it("hides after the user has sent a message", () => {
		const input = baseInput();

		expect(
			shouldShowPreSessionWorktreeCard({
				sessionId: input.sessionId,
				pendingProjectSelection: input.pendingProjectSelection,
				worktreeToggleProjectPath: input.worktreeToggleProjectPath,
				hasPendingWorktreeSetup: input.hasPendingWorktreeSetup,
				worktreeSetupVisible: input.worktreeSetupVisible,
				hasMessages: true,
			})
		).toBe(false);
	});
});

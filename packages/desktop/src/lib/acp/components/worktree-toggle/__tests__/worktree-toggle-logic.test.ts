import { describe, expect, it, mock } from "bun:test";

import {
	computeIsDisabled,
	computeIsPending,
	computeTooltipText,
} from "../worktree-toggle-logic.js";

// Mock i18n messages
mock.module("$lib/paraglide/messages.js", () => ({
	worktree_toggle_checking: () => "Checking...",
	worktree_toggle_creating: () => "Creating...",
	worktree_toggle_not_git_repo: () => "Not a git repo",
	worktree_toggle_disabled_tooltip: () => "Cannot change",
	worktree_toggle_tooltip_create: () => "Create worktree",
	worktree_toggle_has_messages: () => "Has messages",
	worktree_toggle_pending_tooltip: () => "Auto-create on send",
}));

describe("computeIsPending", () => {
	it("returns true when all conditions met", () => {
		expect(computeIsPending(true, false, false, true)).toBe(true);
	});

	it("returns false when globalWorktreeDefault is off", () => {
		expect(computeIsPending(false, false, false, true)).toBe(false);
	});

	it("returns false when worktree already exists", () => {
		expect(computeIsPending(true, true, false, true)).toBe(false);
	});

	it("returns false when session has messages", () => {
		expect(computeIsPending(true, false, true, true)).toBe(false);
	});

	it("returns false when not a git repo", () => {
		expect(computeIsPending(true, false, false, false)).toBe(false);
	});

	it("returns false when isGitRepo is null (unknown)", () => {
		expect(computeIsPending(true, false, false, null)).toBe(false);
	});
});

describe("computeIsDisabled", () => {
	// Args: hasEdits, loading, isGitRepo, isCreatingWorktree, hasMessages, isPending
	it("returns true when hasEdits is true", () => {
		expect(computeIsDisabled(true, false, true, false, false, false)).toBe(true);
	});

	it("returns true when loading is true", () => {
		expect(computeIsDisabled(false, true, true, false, false, false)).toBe(true);
	});

	it("returns true when isGitRepo is false", () => {
		expect(computeIsDisabled(false, false, false, false, false, false)).toBe(true);
	});

	it("returns true when isCreatingWorktree is true", () => {
		expect(computeIsDisabled(false, false, true, true, false, false)).toBe(true);
	});

	it("returns true when hasMessages is true", () => {
		expect(computeIsDisabled(false, false, true, false, true, false)).toBe(true);
	});

	it("returns true when isPending is true", () => {
		expect(computeIsDisabled(false, false, true, false, false, true)).toBe(true);
	});

	it("returns false when isGitRepo is null (unknown)", () => {
		expect(computeIsDisabled(false, false, null, false, false, false)).toBe(false);
	});

	it("returns false when all conditions are met", () => {
		expect(computeIsDisabled(false, false, true, false, false, false)).toBe(false);
	});
});

describe("computeTooltipText", () => {
	// Args: loading, isGitRepo, hasEdits, _enabled, isCreatingWorktree, hasMessages, isPending
	it("returns creating message when isCreatingWorktree is true", () => {
		expect(computeTooltipText(false, true, false, false, true, false, false)).toBe("Creating...");
	});

	it("returns checking message when loading", () => {
		expect(computeTooltipText(true, null, false, false, false, false, false)).toBe("Checking...");
	});

	it("returns not git repo message when isGitRepo is false", () => {
		expect(computeTooltipText(false, false, false, false, false, false, false)).toBe(
			"Not a git repo"
		);
	});

	it("returns pending tooltip when isPending is true", () => {
		expect(computeTooltipText(false, true, false, false, false, false, true)).toBe(
			"Auto-create on send"
		);
	});

	it("returns has messages tooltip when hasMessages is true", () => {
		expect(computeTooltipText(false, true, false, false, false, true, false)).toBe("Has messages");
	});

	it("returns disabled message when hasEdits is true", () => {
		expect(computeTooltipText(false, true, true, false, false, false, false)).toBe("Cannot change");
	});

	it("returns create tooltip when ready", () => {
		expect(computeTooltipText(false, true, false, false, false, false, false)).toBe(
			"Create worktree"
		);
		expect(computeTooltipText(false, true, false, true, false, false, false)).toBe(
			"Create worktree"
		);
	});

	it("prioritizes creating over other states", () => {
		expect(computeTooltipText(true, false, true, true, true, true, true)).toBe("Creating...");
	});

	it("prioritizes loading over other states (except creating)", () => {
		expect(computeTooltipText(true, false, true, true, false, false, false)).toBe("Checking...");
	});

	it("prioritizes not git repo over hasMessages and hasEdits", () => {
		expect(computeTooltipText(false, false, true, true, false, true, false)).toBe("Not a git repo");
	});

	it("prioritizes isPending over hasMessages", () => {
		expect(computeTooltipText(false, true, false, false, false, true, true)).toBe(
			"Auto-create on send"
		);
	});

	it("prioritizes hasMessages over hasEdits", () => {
		expect(computeTooltipText(false, true, true, false, false, true, false)).toBe("Has messages");
	});
});

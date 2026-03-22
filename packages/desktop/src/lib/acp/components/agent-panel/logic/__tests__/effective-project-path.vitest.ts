import { describe, expect, it } from "vitest";

import { resolveEffectiveProjectPath } from "../effective-project-path";

describe("resolveEffectiveProjectPath", () => {
	it("prefers active worktree path over session and project paths", () => {
		expect(
			resolveEffectiveProjectPath({
				activeWorktreePath: "/repo/.worktrees/feature-a",
				sessionWorktreePath: "/repo/.worktrees/feature-b",
				sessionProjectPath: "/repo",
				selectedProjectPath: "/repo",
				singleProjectPath: "/repo",
			})
		).toBe("/repo/.worktrees/feature-a");
	});

	it("uses session worktree path when no active worktree path exists", () => {
		expect(
			resolveEffectiveProjectPath({
				activeWorktreePath: null,
				sessionWorktreePath: "/repo/.worktrees/feature-b",
				sessionProjectPath: "/repo",
				selectedProjectPath: "/repo",
				singleProjectPath: "/repo",
			})
		).toBe("/repo/.worktrees/feature-b");
	});
});

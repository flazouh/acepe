import { describe, expect, it } from "vitest";

import { resolveWorktreeToggleProjectPath } from "./worktree-toggle-project-path.js";

describe("resolveWorktreeToggleProjectPath", () => {
	it("uses selected project path when no session is attached", () => {
		expect(
			resolveWorktreeToggleProjectPath({
				hasSession: false,
				sessionProjectPath: null,
				selectedProjectPath: "/repo/project",
				singleProjectPath: null,
			})
		).toBe("/repo/project");
	});

	it("uses session project path when session is attached", () => {
		expect(
			resolveWorktreeToggleProjectPath({
				hasSession: true,
				sessionProjectPath: "/repo/from-session",
				selectedProjectPath: "/repo/fallback",
				singleProjectPath: null,
			})
		).toBe("/repo/from-session");
	});

	it("falls back to single project path when no session or selected project exists", () => {
		expect(
			resolveWorktreeToggleProjectPath({
				hasSession: false,
				sessionProjectPath: null,
				selectedProjectPath: null,
				singleProjectPath: "/repo/only-project",
			})
		).toBe("/repo/only-project");
	});

	it("does not fall back to selected project while session project is unresolved", () => {
		expect(
			resolveWorktreeToggleProjectPath({
				hasSession: true,
				sessionProjectPath: null,
				selectedProjectPath: "/repo/incorrect-fallback",
				singleProjectPath: "/repo/incorrect-single-fallback",
			})
		).toBeNull();
	});
});

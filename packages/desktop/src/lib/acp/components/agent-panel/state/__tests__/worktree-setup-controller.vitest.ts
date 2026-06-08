import { describe, expect, it } from "vitest";
import { WorktreeSetupController } from "../worktree-setup-controller.svelte.js";

/** Vitest (not Bun): the controller uses Svelte 5 runes. */
describe("WorktreeSetupController", () => {
	it("starts empty", () => {
		expect(new WorktreeSetupController().state).toBeNull();
	});

	it("startCreation populates a visible creating-worktree state", () => {
		const c = new WorktreeSetupController();
		c.startCreation({ projectPath: "/repo", worktreePath: "/repo/.worktrees/feature" });
		expect(c.state).not.toBeNull();
		expect(c.state?.projectPath).toBe("/repo");
		expect(c.state?.isVisible).toBe(true);
	});

	it("clear resets to null", () => {
		const c = new WorktreeSetupController();
		c.startCreation({ projectPath: "/repo" });
		c.clear();
		expect(c.state).toBeNull();
	});
});

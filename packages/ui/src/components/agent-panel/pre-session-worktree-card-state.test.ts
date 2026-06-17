import { describe, expect, test } from "bun:test";

import {
	getPreSessionWorktreeIconClass,
	getPreSessionWorktreeLockedWidth,
	getPreSessionWorktreeMode,
	getPreSessionWorktreeModeOptions,
	getSelectedPreSessionWorktreeModeOption,
	shouldShowPreSessionWorktreeExpanded,
} from "./pre-session-worktree-card-state.js";

describe("pre-session worktree card state", () => {
	test("maps pending selection to launch mode", () => {
		expect(getPreSessionWorktreeMode({ pendingWorktreeEnabled: false })).toBe("local");
		expect(getPreSessionWorktreeMode({ pendingWorktreeEnabled: true })).toBe("worktree");
	});

	test("builds mode options from labels", () => {
		expect(
			getPreSessionWorktreeModeOptions({
				localLabel: "Work locally",
				worktreeLabel: "New worktree",
			})
		).toEqual([
			{ id: "local", label: "Work locally" },
			{ id: "worktree", label: "New worktree" },
		]);
	});

	test("resolves the selected mode option", () => {
		const modeOptions = getPreSessionWorktreeModeOptions({
			localLabel: "Work locally",
			worktreeLabel: "New worktree",
		});
		expect(
			getSelectedPreSessionWorktreeModeOption({
				mode: "worktree",
				modeOptions,
			})
		).toEqual({ id: "worktree", label: "New worktree" });
	});

	test("maps the tree icon color from launch mode", () => {
		expect(getPreSessionWorktreeIconClass({ mode: "worktree" })).toBe("text-success");
		expect(getPreSessionWorktreeIconClass({ mode: "local" })).toBe("text-muted-foreground");
	});

	test("only shows expanded content when it is open and available", () => {
		expect(
			shouldShowPreSessionWorktreeExpanded({
				isExpanded: true,
				hasExpandable: true,
			})
		).toBe(true);
		expect(
			shouldShowPreSessionWorktreeExpanded({
				isExpanded: true,
				hasExpandable: false,
			})
		).toBe(false);
	});

	test("locks width only while expanded with a measured width", () => {
		expect(
			getPreSessionWorktreeLockedWidth({
				showExpanded: true,
				expandedWidth: 243,
			})
		).toBe("243px");
		expect(
			getPreSessionWorktreeLockedWidth({
				showExpanded: true,
				expandedWidth: null,
			})
		).toBeNull();
		expect(
			getPreSessionWorktreeLockedWidth({
				showExpanded: false,
				expandedWidth: 243,
			})
		).toBeNull();
	});
});

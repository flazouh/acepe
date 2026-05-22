import { describe, expect, test } from "bun:test";

import {
	getPreSessionWorktreeIconClass,
	getPreSessionWorktreeLockedWidth,
	getPreSessionWorktreeToggleItems,
	getPreSessionWorktreeToggleValue,
	isPreSessionWorktreeOn,
	shouldShowPreSessionWorktreeExpanded,
} from "./pre-session-worktree-card-state.js";

describe("pre-session worktree card state", () => {
	test("turns worktree on when either normal or always mode is enabled", () => {
		expect(
			isPreSessionWorktreeOn({
				pendingWorktreeEnabled: false,
				alwaysEnabled: false,
			})
		).toBe(false);
		expect(
			isPreSessionWorktreeOn({
				pendingWorktreeEnabled: true,
				alwaysEnabled: false,
			})
		).toBe(true);
		expect(
			isPreSessionWorktreeOn({
				pendingWorktreeEnabled: false,
				alwaysEnabled: true,
			})
		).toBe(true);
	});

	test("builds toggle value and items from labels", () => {
		expect(
			getPreSessionWorktreeToggleValue({
				pendingWorktreeEnabled: false,
				alwaysEnabled: false,
			})
		).toBe("no");
		expect(
			getPreSessionWorktreeToggleValue({
				pendingWorktreeEnabled: false,
				alwaysEnabled: true,
			})
		).toBe("yes");
		expect(
			getPreSessionWorktreeToggleItems({
				yesLabel: "Yes",
				noLabel: "No",
			})
		).toEqual([
			{ id: "yes", label: "Yes" },
			{ id: "no", label: "No" },
		]);
	});

	test("maps the tree icon color from worktree state", () => {
		expect(
			getPreSessionWorktreeIconClass({
				worktreeOn: true,
				alwaysEnabled: true,
			})
		).toBe("text-purple-400");
		expect(
			getPreSessionWorktreeIconClass({
				worktreeOn: true,
				alwaysEnabled: false,
			})
		).toBe("text-success");
		expect(
			getPreSessionWorktreeIconClass({
				worktreeOn: false,
				alwaysEnabled: false,
			})
		).toBe("text-destructive");
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

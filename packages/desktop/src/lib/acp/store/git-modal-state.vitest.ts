import { describe, expect, it } from "vitest";

import type { WorktreeInfo } from "$lib/acp/types/worktree-info.js";

import {
	buildWorktreeListItems,
	normalizeCommitLookupQuery,
	resolveCurrentWorktree,
} from "./git-modal-state.js";

describe("resolveCurrentWorktree", () => {
	it("returns the matching worktree when the project path is a worktree", () => {
		const worktrees: WorktreeInfo[] = [
			{
				name: "feat-source-control",
				branch: "feat/source-control",
				directory: "/repo/.worktrees/feat-source-control",
				origin: "acepe",
			},
		];

		expect(resolveCurrentWorktree("/repo/.worktrees/feat-source-control", worktrees)).toEqual(
			worktrees[0]
		);
	});

	it("returns null when the project path is the main repository", () => {
		const worktrees: WorktreeInfo[] = [
			{
				name: "feat-source-control",
				branch: "feat/source-control",
				directory: "/repo/.worktrees/feat-source-control",
				origin: "acepe",
			},
		];

		expect(resolveCurrentWorktree("/repo", worktrees)).toBeNull();
	});
});

describe("buildWorktreeListItems", () => {
	it("places the current worktree first and marks it active", () => {
		const worktrees: WorktreeInfo[] = [
			{
				name: "zebra",
				branch: "feat/zebra",
				directory: "/repo/.worktrees/zebra",
				origin: "acepe",
			},
			{
				name: "alpha",
				branch: "feat/alpha",
				directory: "/repo/.worktrees/alpha",
				origin: "external",
			},
		];

		const items = buildWorktreeListItems("/repo/.worktrees/zebra", worktrees);

		expect(items.map((item) => item.worktree.name)).toEqual(["zebra", "alpha"]);
		expect(items[0]?.isCurrent).toBe(true);
		expect(items[1]?.isCurrent).toBe(false);
	});
});

describe("normalizeCommitLookupQuery", () => {
	it("trims whitespace and preserves valid commit-like queries", () => {
		expect(normalizeCommitLookupQuery("  abc1234  ")).toBe("abc1234");
	});

	it("returns null for empty queries", () => {
		expect(normalizeCommitLookupQuery("   ")).toBeNull();
	});
});

import { describe, expect, it } from "bun:test";

import {
	branchExists,
	canCreateBranch,
	filterBranchesByQuery,
	getFullBranchName,
	getNewBranchNameError,
	getNormalizedBranchName,
	getWorktreeBranches,
	shouldLoadBranchList,
} from "./branch-picker-state.js";

const branches = ["main", "feat/chat", "fix/login"];

describe("branch picker state", () => {
	it("filters branches by case-insensitive query", () => {
		expect(filterBranchesByQuery(branches, "")).toBe(branches);
		expect(filterBranchesByQuery(branches, " FEAT ")).toEqual(["feat/chat"]);
		expect(filterBranchesByQuery(branches, "log")).toEqual(["fix/login"]);
	});

	it("normalizes and combines branch prefix and name", () => {
		expect(getNormalizedBranchName(" new-thing ")).toBe("new-thing");
		expect(
			getFullBranchName({
				prefix: { value: "feat/" },
				branchName: " new-thing ",
			})
		).toBe("feat/new-thing");
	});

	it("detects existing branches without caring about case", () => {
		expect(branchExists({ branches, fullBranchName: "FEAT/CHAT" })).toBe(true);
		expect(branchExists({ branches, fullBranchName: "feat/new" })).toBe(false);
	});

	it("validates new branch names", () => {
		expect(
			getNewBranchNameError({
				normalizedBranchName: "",
				fullBranchName: "feat/",
				branches,
			})
		).toBeNull();
		expect(
			getNewBranchNameError({
				normalizedBranchName: "chat",
				fullBranchName: "feat/chat",
				branches,
			})
		).toBe("Branch already exists");
		expect(
			getNewBranchNameError({
				normalizedBranchName: "chat/",
				fullBranchName: "feat/chat/",
				branches,
			})
		).toBe('Branch name cannot end with "/"');
		expect(
			getNewBranchNameError({
				normalizedBranchName: "chat page",
				fullBranchName: "feat/chat page",
				branches,
			})
		).toBe("Branch name cannot contain spaces");
	});

	it("allows branch creation only with a valid name while idle", () => {
		expect(
			canCreateBranch({
				normalizedBranchName: "chat",
				error: null,
				switchingBranch: false,
			})
		).toBe(true);
		expect(
			canCreateBranch({
				normalizedBranchName: "",
				error: null,
				switchingBranch: false,
			})
		).toBe(false);
		expect(
			canCreateBranch({
				normalizedBranchName: "chat",
				error: "Branch already exists",
				switchingBranch: false,
			})
		).toBe(false);
		expect(
			canCreateBranch({
				normalizedBranchName: "chat",
				error: null,
				switchingBranch: true,
			})
		).toBe(false);
	});

	it("loads branch list only for an open non-worktree project picker", () => {
		expect(
			shouldLoadBranchList({
				branchPopoverOpen: true,
				projectPath: "/repo",
				isWorktree: false,
			})
		).toBe(true);
		expect(
			shouldLoadBranchList({
				branchPopoverOpen: false,
				projectPath: "/repo",
				isWorktree: false,
			})
		).toBe(false);
		expect(
			shouldLoadBranchList({
				branchPopoverOpen: true,
				projectPath: "/repo",
				isWorktree: true,
			})
		).toBe(false);
	});

	it("uses only the current branch for worktrees", () => {
		expect(getWorktreeBranches("feature")).toEqual(["feature"]);
		expect(getWorktreeBranches(null)).toEqual([]);
	});
});

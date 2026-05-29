import { describe, expect, it } from "vitest";
import type {
	GitLogEntry,
	GitPanelFileStatus,
	GitRemoteStatus,
	GitStackedPrStep,
	GitStashEntry,
} from "$lib/utils/tauri-client/git.js";
import {
	buildCommitPushPrSuccessMessage,
	buildNavigableChangesFiles,
	computeCanCommitPush,
	computeCanCommitPushPr,
	computeNextChangesFileIndex,
	isChangesNavigationKey,
	mapStagedFiles,
	mapUiLogEntries,
	mapUiRemoteStatus,
	mapUiStashEntries,
	mapUnstagedFiles,
} from "../git-panel-logic.js";

function fileStatus(overrides: Partial<GitPanelFileStatus>): GitPanelFileStatus {
	return {
		path: "file.txt",
		indexStatus: null,
		worktreeStatus: null,
		indexInsertions: 0,
		indexDeletions: 0,
		worktreeInsertions: 0,
		worktreeDeletions: 0,
		...overrides,
	};
}

describe("mapStagedFiles", () => {
	it("returns only files with an index status, using index counts", () => {
		const result = mapStagedFiles([
			fileStatus({ path: "a.ts", indexStatus: "modified", indexInsertions: 3, indexDeletions: 1 }),
			fileStatus({ path: "b.ts", indexStatus: null, worktreeStatus: "modified" }),
		]);
		expect(result).toEqual([
			{ path: "a.ts", indexStatus: "modified", worktreeStatus: null, additions: 3, deletions: 1 },
		]);
	});

	it("returns empty array for empty input", () => {
		expect(mapStagedFiles([])).toEqual([]);
	});

	it("carries worktreeStatus through when also present in index", () => {
		const result = mapStagedFiles([
			fileStatus({ path: "a.ts", indexStatus: "added", worktreeStatus: "modified" }),
		]);
		expect(result[0]?.worktreeStatus).toBe("modified");
	});
});

describe("mapUnstagedFiles", () => {
	it("returns only files with a worktree status and no index status, using worktree counts", () => {
		const result = mapUnstagedFiles([
			fileStatus({
				path: "a.ts",
				worktreeStatus: "modified",
				worktreeInsertions: 5,
				worktreeDeletions: 2,
			}),
			fileStatus({ path: "b.ts", indexStatus: "added", worktreeStatus: "modified" }),
			fileStatus({ path: "c.ts" }),
		]);
		expect(result).toEqual([
			{ path: "a.ts", indexStatus: null, worktreeStatus: "modified", additions: 5, deletions: 2 },
		]);
	});
});

describe("buildNavigableChangesFiles", () => {
	it("orders staged before unstaged and maps statuses", () => {
		const staged = mapStagedFiles([fileStatus({ path: "s.ts", indexStatus: "added" })]);
		const unstaged = mapUnstagedFiles([
			fileStatus({ path: "u.ts", worktreeStatus: "untracked" }),
			fileStatus({ path: "d.ts", worktreeStatus: "deleted" }),
		]);
		const result = buildNavigableChangesFiles(staged, unstaged);
		expect(result.map((entry) => entry.file.path)).toEqual(["s.ts", "u.ts", "d.ts"]);
		expect(result[0]).toMatchObject({ staged: true, file: { status: "added" } });
		// untracked maps to "added" for FileDiff display
		expect(result[1]).toMatchObject({ staged: false, file: { status: "added" } });
		expect(result[2]).toMatchObject({ staged: false, file: { status: "deleted" } });
	});

	it("is empty when both inputs empty", () => {
		expect(buildNavigableChangesFiles([], [])).toEqual([]);
	});
});

describe("mapUiRemoteStatus", () => {
	it("returns null for null input", () => {
		expect(mapUiRemoteStatus(null)).toBeNull();
	});

	it("maps fields verbatim", () => {
		const remote: GitRemoteStatus = {
			ahead: 2,
			behind: 1,
			remote: "origin",
			trackingBranch: "origin/main",
		};
		expect(mapUiRemoteStatus(remote)).toEqual({
			ahead: 2,
			behind: 1,
			remote: "origin",
			trackingBranch: "origin/main",
		});
	});
});

describe("mapUiStashEntries / mapUiLogEntries", () => {
	it("maps stash entries", () => {
		const entries: GitStashEntry[] = [{ index: 0, message: "wip", date: "2024-01-01" }];
		expect(mapUiStashEntries(entries)).toEqual([{ index: 0, message: "wip", date: "2024-01-01" }]);
	});

	it("maps log entries", () => {
		const entries: GitLogEntry[] = [
			{ sha: "abc123", shortSha: "abc", message: "msg", author: "me", date: "2024-01-01" },
		];
		expect(mapUiLogEntries(entries)).toEqual([
			{ sha: "abc123", shortSha: "abc", message: "msg", author: "me", date: "2024-01-01" },
		]);
	});

	it("returns empty arrays for empty input", () => {
		expect(mapUiStashEntries([])).toEqual([]);
		expect(mapUiLogEntries([])).toEqual([]);
	});
});

describe("computeCanCommitPush", () => {
	const remote: GitRemoteStatus = {
		ahead: 0,
		behind: 0,
		remote: "origin",
		trackingBranch: "origin/main",
	};

	it("is true when staged files exist on a branch and no action running", () => {
		expect(
			computeCanCommitPush({
				stagedFileCount: 1,
				remoteStatus: remote,
				branch: "main",
				stackedActionRunning: false,
			})
		).toBe(true);
	});

	it("is true when nothing staged but ahead of remote", () => {
		expect(
			computeCanCommitPush({
				stagedFileCount: 0,
				remoteStatus: { ...remote, ahead: 2 },
				branch: "main",
				stackedActionRunning: false,
			})
		).toBe(true);
	});

	it("is false with no work", () => {
		expect(
			computeCanCommitPush({
				stagedFileCount: 0,
				remoteStatus: remote,
				branch: "main",
				stackedActionRunning: false,
			})
		).toBe(false);
	});

	it("is false without a branch", () => {
		expect(
			computeCanCommitPush({
				stagedFileCount: 1,
				remoteStatus: remote,
				branch: null,
				stackedActionRunning: false,
			})
		).toBe(false);
	});

	it("is false while a stacked action is running", () => {
		expect(
			computeCanCommitPush({
				stagedFileCount: 1,
				remoteStatus: remote,
				branch: "main",
				stackedActionRunning: true,
			})
		).toBe(false);
	});

	it("treats null remoteStatus as no ahead commits", () => {
		expect(
			computeCanCommitPush({
				stagedFileCount: 0,
				remoteStatus: null,
				branch: "main",
				stackedActionRunning: false,
			})
		).toBe(false);
	});
});

describe("computeCanCommitPushPr", () => {
	it("requires a tracking branch", () => {
		expect(
			computeCanCommitPushPr({
				canCommitPush: true,
				remoteStatus: { ahead: 0, behind: 0, remote: "origin", trackingBranch: "origin/main" },
			})
		).toBe(true);
	});

	it("is false when canCommitPush is false", () => {
		expect(
			computeCanCommitPushPr({
				canCommitPush: false,
				remoteStatus: { ahead: 0, behind: 0, remote: "origin", trackingBranch: "origin/main" },
			})
		).toBe(false);
	});

	it("is false without a tracking branch", () => {
		expect(
			computeCanCommitPushPr({
				canCommitPush: true,
				remoteStatus: { ahead: 0, behind: 0, remote: "origin", trackingBranch: "" },
			})
		).toBe(false);
		expect(computeCanCommitPushPr({ canCommitPush: true, remoteStatus: null })).toBe(false);
	});
});

describe("isChangesNavigationKey", () => {
	it("matches arrow up/down only", () => {
		expect(isChangesNavigationKey("ArrowDown")).toBe(true);
		expect(isChangesNavigationKey("ArrowUp")).toBe(true);
		expect(isChangesNavigationKey("Enter")).toBe(false);
		expect(isChangesNavigationKey("a")).toBe(false);
	});
});

describe("computeNextChangesFileIndex", () => {
	it("returns currentIndex unchanged when list empty", () => {
		expect(computeNextChangesFileIndex({ key: "ArrowDown", currentIndex: -1, length: 0 })).toBe(-1);
		expect(computeNextChangesFileIndex({ key: "ArrowUp", currentIndex: 5, length: 0 })).toBe(5);
	});

	it("falls back to first item on ArrowDown when nothing selected", () => {
		expect(computeNextChangesFileIndex({ key: "ArrowDown", currentIndex: -1, length: 3 })).toBe(0);
	});

	it("falls back to last item on ArrowUp when nothing selected", () => {
		expect(computeNextChangesFileIndex({ key: "ArrowUp", currentIndex: -1, length: 3 })).toBe(2);
	});

	it("moves down and clamps at the end", () => {
		expect(computeNextChangesFileIndex({ key: "ArrowDown", currentIndex: 0, length: 3 })).toBe(1);
		expect(computeNextChangesFileIndex({ key: "ArrowDown", currentIndex: 2, length: 3 })).toBe(2);
	});

	it("moves up and clamps at the start", () => {
		expect(computeNextChangesFileIndex({ key: "ArrowUp", currentIndex: 2, length: 3 })).toBe(1);
		expect(computeNextChangesFileIndex({ key: "ArrowUp", currentIndex: 0, length: 3 })).toBe(0);
	});
});

describe("buildCommitPushPrSuccessMessage", () => {
	function prStep(overrides: Partial<GitStackedPrStep>): GitStackedPrStep {
		return { status: "created", number: 1, url: "https://example.com", ...overrides };
	}

	it("formats created PR", () => {
		expect(buildCommitPushPrSuccessMessage(prStep({ status: "created", number: 42 }))).toBe(
			"Created PR #42"
		);
	});

	it("formats opened existing PR", () => {
		expect(buildCommitPushPrSuccessMessage(prStep({ status: "opened_existing", number: 7 }))).toBe(
			"Opened PR #7"
		);
	});

	it("formats skipped PR as pushed to branch", () => {
		expect(
			buildCommitPushPrSuccessMessage(
				prStep({ status: "skipped_not_requested", number: undefined })
			)
		).toBe("Pushed to branch");
	});

	it("handles missing PR number gracefully", () => {
		expect(buildCommitPushPrSuccessMessage(prStep({ status: "created", number: undefined }))).toBe(
			"Created PR #"
		);
	});
});

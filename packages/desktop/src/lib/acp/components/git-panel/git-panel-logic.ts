import type {
	GitIndexStatus,
	GitLogEntry as UILogEntry,
	GitRemoteStatus as UIRemoteStatus,
	GitStashEntry as UIStashEntry,
	GitStatusFile,
	GitWorktreeStatus,
} from "@acepe/ui/git-panel";
import type {
	GitLogEntry,
	GitPanelFileStatus,
	GitRemoteStatus,
	GitStackedPrStep,
	GitStashEntry,
} from "$lib/utils/tauri-client/git.js";
import type { FileDiff } from "../../types/github-integration.js";

/**
 * Pure logic functions for the git panel controller.
 *
 * All functions are pure - no side effects, no runes, no DOM. They map the
 * Tauri-backed git domain types into the shared `@acepe/ui` git-panel view
 * types and compute the controller's derived flags. Keeping them here lets the
 * `git-panel.svelte` controller stay thin and lets this logic be unit-tested
 * directly.
 */

/** A changes-list file entry that the keyboard navigation cycles through. */
export interface NavigableChangesFile {
	readonly file: {
		readonly path: string;
		readonly status: FileDiff["status"];
		readonly additions: number;
		readonly deletions: number;
	};
	readonly staged: boolean;
}

/** Map Tauri file status → shared UI staged `GitStatusFile` list. */
export function mapStagedFiles(files: readonly GitPanelFileStatus[]): GitStatusFile[] {
	return files
		.filter((f) => f.indexStatus !== null)
		.map((f) => ({
			path: f.path,
			indexStatus: f.indexStatus as GitIndexStatus,
			worktreeStatus: f.worktreeStatus as GitWorktreeStatus | null,
			additions: f.indexInsertions,
			deletions: f.indexDeletions,
		}));
}

/** Map Tauri file status → shared UI unstaged `GitStatusFile` list. */
export function mapUnstagedFiles(files: readonly GitPanelFileStatus[]): GitStatusFile[] {
	return files
		.filter((f) => f.worktreeStatus !== null && f.indexStatus === null)
		.map((f) => ({
			path: f.path,
			indexStatus: null,
			worktreeStatus: f.worktreeStatus as GitWorktreeStatus,
			additions: f.worktreeInsertions,
			deletions: f.worktreeDeletions,
		}));
}

/**
 * Build the ordered, keyboard-navigable list of changed files (staged first,
 * then unstaged), translating UI statuses into `FileDiff` statuses.
 */
export function buildNavigableChangesFiles(
	stagedFiles: readonly GitStatusFile[],
	unstagedFiles: readonly GitStatusFile[]
): NavigableChangesFile[] {
	return [
		...stagedFiles.map((file) => ({
			file: {
				path: file.path,
				status: (file.indexStatus ?? "modified") as FileDiff["status"],
				additions: file.additions,
				deletions: file.deletions,
			},
			staged: true,
		})),
		...unstagedFiles.map((file) => ({
			file: {
				path: file.path,
				status: (file.worktreeStatus === "untracked"
					? "added"
					: (file.worktreeStatus ?? "modified")) as FileDiff["status"],
				additions: file.additions,
				deletions: file.deletions,
			},
			staged: false,
		})),
	];
}

/** Map Tauri remote status → shared UI remote status. */
export function mapUiRemoteStatus(remoteStatus: GitRemoteStatus | null): UIRemoteStatus | null {
	if (remoteStatus === null) {
		return null;
	}
	return {
		ahead: remoteStatus.ahead,
		behind: remoteStatus.behind,
		remote: remoteStatus.remote,
		trackingBranch: remoteStatus.trackingBranch,
	};
}

/** Map Tauri stash entries → shared UI stash entries. */
export function mapUiStashEntries(stashEntries: readonly GitStashEntry[]): UIStashEntry[] {
	return stashEntries.map((s) => ({ index: s.index, message: s.message, date: s.date }));
}

/** Map Tauri log entries → shared UI log entries. */
export function mapUiLogEntries(logEntries: readonly GitLogEntry[]): UILogEntry[] {
	return logEntries.map((l) => ({
		sha: l.sha,
		shortSha: l.shortSha,
		message: l.message,
		author: l.author,
		date: l.date,
	}));
}

/** Whether the "Commit & push" action is currently allowed. */
export function computeCanCommitPush(input: {
	readonly stagedFileCount: number;
	readonly remoteStatus: GitRemoteStatus | null;
	readonly branch: string | null;
	readonly stackedActionRunning: boolean;
}): boolean {
	const hasWork = input.stagedFileCount > 0 || (input.remoteStatus?.ahead ?? 0) > 0;
	return hasWork && !!input.branch && !input.stackedActionRunning;
}

/** Whether the "Commit, push & create PR" action is currently allowed. */
export function computeCanCommitPushPr(input: {
	readonly canCommitPush: boolean;
	readonly remoteStatus: GitRemoteStatus | null;
}): boolean {
	return input.canCommitPush && (input.remoteStatus?.trackingBranch?.length ?? 0) > 0;
}

/** Whether a key event should move the changes-list selection. */
export function isChangesNavigationKey(key: string): key is "ArrowDown" | "ArrowUp" {
	return key === "ArrowDown" || key === "ArrowUp";
}

/**
 * Compute the next selected index when navigating the changes list with the
 * arrow keys. Returns the existing index unchanged when the list is empty.
 */
export function computeNextChangesFileIndex(input: {
	readonly key: "ArrowDown" | "ArrowUp";
	readonly currentIndex: number;
	readonly length: number;
}): number {
	if (input.length === 0) {
		return input.currentIndex;
	}
	const fallbackIndex = input.key === "ArrowDown" ? 0 : input.length - 1;
	if (input.currentIndex === -1) {
		return fallbackIndex;
	}
	return input.key === "ArrowDown"
		? Math.min(input.currentIndex + 1, input.length - 1)
		: Math.max(input.currentIndex - 1, 0);
}

/** Build the toast message for a completed commit_push_pr stacked action. */
export function buildCommitPushPrSuccessMessage(pr: GitStackedPrStep): string {
	switch (pr.status) {
		case "created":
			return `Created PR #${pr.number ?? ""}`;
		case "opened_existing":
			return `Opened PR #${pr.number ?? ""}`;
		case "skipped_not_requested":
			return "Pushed to branch";
		default: {
			const _: never = pr.status;
			return "Pushed to branch";
		}
	}
}

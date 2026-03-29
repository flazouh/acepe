import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type { CloneResult } from "../../acp/types/index.js";
import type { SetupResult, WorktreeConfig } from "../../acp/types/worktree-config.js";
import type { WorktreeInfo } from "../../acp/types/worktree-info.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const git = {
	clone: (
		url: string,
		destination: string,
		branch?: string
	): ResultAsync<CloneResult, AppError> => {
		return invokeAsync(CMD.git.clone, { url, destination, branch });
	},

	browseDestination: (): ResultAsync<string | null, AppError> => {
		return invokeAsync(CMD.git.browse_destination);
	},

	init: (projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.init, { projectPath });
	},

	isRepo: (projectPath: string): ResultAsync<boolean, AppError> => {
		return invokeAsync(CMD.git.is_repo, { projectPath });
	},

	currentBranch: (projectPath: string): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.git.current_branch, { projectPath });
	},

	listBranches: (projectPath: string): ResultAsync<string[], AppError> => {
		return invokeAsync(CMD.git.list_branches, { projectPath });
	},

	checkoutBranch: (
		projectPath: string,
		branch: string,
		create = false
	): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.git.checkout_branch, { projectPath, branch, create });
	},

	hasUncommittedChanges: (projectPath: string): ResultAsync<boolean, AppError> => {
		return invokeAsync(CMD.git.has_uncommitted_changes, { projectPath });
	},

	worktreeCreate: (projectPath: string): ResultAsync<WorktreeInfo, AppError> => {
		return invokeAsync(CMD.git.worktree_create, { projectPath });
	},

	worktreeRemove: (worktreePath: string, force?: boolean): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.worktree_remove, {
			worktreePath,
			force: force ?? false,
		});
	},

	worktreeReset: (worktreePath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.worktree_reset, { worktreePath });
	},

	worktreeList: (projectPath: string): ResultAsync<WorktreeInfo[], AppError> => {
		return invokeAsync(CMD.git.worktree_list, { projectPath });
	},

	worktreeRename: (worktreePath: string, newName: string): ResultAsync<WorktreeInfo, AppError> => {
		return invokeAsync(CMD.git.worktree_rename, { worktreePath, newName });
	},

	worktreeDiskSize: (path: string): ResultAsync<number, AppError> => {
		return invokeAsync(CMD.git.worktree_disk_size, { path });
	},

	// ─── Git Panel Operations ───────────────────────────────────────────

	panelStatus: (projectPath: string): ResultAsync<GitPanelFileStatus[], AppError> => {
		return invokeAsync(CMD.git.panel_status, { projectPath });
	},

	diffStats: (projectPath: string): ResultAsync<GitDiffStats, AppError> => {
		return invokeAsync(CMD.git.diff_stats, { projectPath });
	},

	stageFiles: (projectPath: string, files: string[]): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.stage_files, { projectPath, files });
	},

	unstageFiles: (projectPath: string, files: string[]): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.unstage_files, { projectPath, files });
	},

	stageAll: (projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.stage_all, { projectPath });
	},

	discardChanges: (projectPath: string, files: string[]): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.discard_changes, { projectPath, files });
	},

	commit: (projectPath: string, message: string): ResultAsync<GitCommitResult, AppError> => {
		return invokeAsync(CMD.git.commit, { projectPath, message });
	},

	push: (projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.push, { projectPath });
	},

	pull: (projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.pull, { projectPath });
	},

	fetch: (projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.fetch, { projectPath });
	},

	remoteStatus: (projectPath: string): ResultAsync<GitRemoteStatus, AppError> => {
		return invokeAsync(CMD.git.remote_status, { projectPath });
	},

	stashList: (projectPath: string): ResultAsync<GitStashEntry[], AppError> => {
		return invokeAsync(CMD.git.stash_list, { projectPath });
	},

	stashPop: (projectPath: string, index: number): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.stash_pop, { projectPath, index });
	},

	stashDrop: (projectPath: string, index: number): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.stash_drop, { projectPath, index });
	},

	stashSave: (projectPath: string, message?: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.stash_save, { projectPath, message });
	},

	log: (projectPath: string, limit = 50): ResultAsync<GitLogEntry[], AppError> => {
		return invokeAsync(CMD.git.log, { projectPath, limit });
	},

	createBranch: (
		projectPath: string,
		name: string,
		startPoint?: string
	): ResultAsync<string, AppError> => {
		return invokeAsync(CMD.git.create_branch, { projectPath, name, startPoint });
	},

	deleteBranch: (projectPath: string, name: string, force = false): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.delete_branch, { projectPath, name, force });
	},

	/**
	 * Runs commit, then optionally push and create/open PR in one Tauri call.
	 * Use "commit" for local-only; "commit_push" to also push; "commit_push_pr" to push and create or open a PR.
	 *
	 * @param projectPath - Path to the git project root.
	 * @param action - "commit" | "commit_push" | "commit_push_pr"
	 * @param commitMessage - Message for the commit.
	 * @returns ResultAsync resolving to per-step result (commit, push, pr).
	 */
	runStackedAction: (
		projectPath: string,
		action: GitStackedAction,
		commitMessage: string,
		prTitle?: string,
		prBody?: string,
	): ResultAsync<GitStackedActionResult, AppError> => {
		return invokeAsync(CMD.git.run_stacked_action, {
			projectPath,
			action,
			commitMessage,
			prTitle,
			prBody,
		});
	},

	/**
	 * Collect staged diff context and build the AI generation prompt.
	 * Returns null if nothing is staged.
	 */
	collectShipContext: (
		projectPath: string,
		customInstructions?: string,
	): ResultAsync<ShipContext | null, AppError> => {
		return invokeAsync(CMD.git.collect_ship_context, { projectPath, customInstructions });
	},

	prDetails: (projectPath: string, prNumber: number): ResultAsync<PrDetails, AppError> => {
		return invokeAsync(CMD.git.pr_details, { projectPath, prNumber });
	},

	mergePr: (
		projectPath: string,
		prNumber: number,
		strategy: MergeStrategy,
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.merge_pr, { projectPath, prNumber, strategy });
	},

	getOpenPrForBranch: (projectPath: string): ResultAsync<OpenPrInfo | null, AppError> => {
		return invokeAsync(CMD.git.get_open_pr_for_branch, { projectPath });
	},

	// ─── Git HEAD Watcher ──────────────────────────────────────────────

	watchHead: (projectPath: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.watch_head, { projectPath });
	},

	loadWorktreeConfig: (projectPath: string): ResultAsync<WorktreeConfig | null, AppError> => {
		return invokeAsync(CMD.git.load_worktree_config, { projectPath });
	},

	runWorktreeSetup: (
		worktreePath: string,
		projectPath: string
	): ResultAsync<SetupResult, AppError> => {
		return invokeAsync(CMD.git.run_worktree_setup, { worktreePath, projectPath });
	},

	saveWorktreeConfig: (
		projectPath: string,
		setupCommands: string[]
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.git.save_worktree_config, { projectPath, setupCommands });
	},
};

// ─── Types (matching Rust structs from git/operations.rs) ───────────────

export interface GitPanelFileStatus {
	path: string;
	indexStatus: string | null;
	worktreeStatus: string | null;
	insertions: number;
	deletions: number;
}

export interface GitDiffStats {
	insertions: number;
	deletions: number;
	filesChanged: number;
}

export interface GitCommitResult {
	sha: string;
	shortSha: string;
}

export interface GitRemoteStatus {
	ahead: number;
	behind: number;
	remote: string;
	trackingBranch: string;
}

export interface GitStashEntry {
	index: number;
	message: string;
	date: string;
}

export interface GitLogEntry {
	sha: string;
	shortSha: string;
	message: string;
	author: string;
	date: string;
}

export type GitStackedAction = "commit" | "commit_push" | "commit_push_pr";

export type MergeStrategy = "squash" | "merge" | "rebase";

export interface GitStackedCommitStep {
	status: "created" | "skipped_no_changes";
	commitSha?: string;
	subject?: string;
}

export interface GitStackedPushStep {
	status: "pushed" | "skipped_not_requested";
	branch?: string;
	upstreamBranch?: string;
}

export interface GitStackedPrStep {
	status: "created" | "opened_existing" | "skipped_not_requested";
	url?: string;
	number?: number;
	title?: string;
	baseBranch?: string;
	headBranch?: string;
}

export interface GitStackedActionResult {
	action: GitStackedAction;
	commit: GitStackedCommitStep;
	push: GitStackedPushStep;
	pr: GitStackedPrStep;
}

export interface OpenPrInfo {
	number: number;
	title: string;
	url: string;
}

export interface PrCommit {
	oid: string;
	messageHeadline: string;
	additions: number;
	deletions: number;
}

/** Pull request state as reported by GitHub. */
export type PrState = "OPEN" | "CLOSED" | "MERGED";

/** PR details fetched from GitHub. */
export interface PrDetails {
	number: number;
	title: string;
	body: string;
	state: PrState;
	url: string;
	isDraft: boolean;
	additions: number;
	deletions: number;
	commits: PrCommit[];
}

/** Context returned by git_collect_ship_context for AI generation. */
export interface ShipContext {
	/** The full prompt to send to the ACP agent. */
	prompt: string;
	/** Current git branch name. */
	branch: string;
	/** Summary of staged files (name-status). */
	stagedSummary: string;
}

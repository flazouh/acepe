import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import type { CloneResult } from "../../acp/types/index.js";
import type { SetupResult, WorktreeConfig } from "../../acp/types/worktree-config.js";
import type { PreparedWorktreeLaunch, WorktreeInfo } from "../../acp/types/worktree-info.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const gitCommands = TAURI_COMMAND_CLIENT.git;

export const git = {
	clone: (
		url: string,
		destination: string,
		branch?: string
	): ResultAsync<CloneResult, AppError> => {
		return gitCommands.clone.invoke<CloneResult>({ url, destination, branch });
	},

	browseDestination: (): ResultAsync<string | null, AppError> => {
		return gitCommands.browse_destination.invoke<string | null>();
	},

	init: (projectPath: string): ResultAsync<void, AppError> => {
		return gitCommands.init.invoke<void>({ projectPath });
	},

	isRepo: (projectPath: string): ResultAsync<boolean, AppError> => {
		return gitCommands.is_repo.invoke<boolean>({ projectPath });
	},

	currentBranch: (projectPath: string): ResultAsync<string, AppError> => {
		return gitCommands.current_branch.invoke<string>({ projectPath });
	},

	listBranches: (projectPath: string): ResultAsync<string[], AppError> => {
		return gitCommands.list_branches.invoke<string[]>({ projectPath });
	},

	checkoutBranch: (
		projectPath: string,
		branch: string,
		create = false
	): ResultAsync<string, AppError> => {
		return gitCommands.checkout_branch.invoke<string>({ projectPath, branch, create });
	},

	hasUncommittedChanges: (projectPath: string): ResultAsync<boolean, AppError> => {
		return gitCommands.has_uncommitted_changes.invoke<boolean>({ projectPath });
	},

	worktreeCreate: (projectPath: string): ResultAsync<WorktreeInfo, AppError> => {
		return gitCommands.worktree_create.invoke<WorktreeInfo>({ projectPath });
	},

	prepareWorktreeSessionLaunch: (
		projectPath: string,
		agentId: string
	): ResultAsync<PreparedWorktreeLaunch, AppError> => {
		return gitCommands.prepare_worktree_session_launch.invoke<PreparedWorktreeLaunch>({
			projectPath,
			agentId,
		});
	},

	discardPreparedWorktreeSessionLaunch: (
		launchToken: string,
		removeWorktree = false
	): ResultAsync<void, AppError> => {
		return gitCommands.discard_prepared_worktree_session_launch.invoke<void>({
			launchToken,
			removeWorktree,
		});
	},

	worktreeRemove: (worktreePath: string, force?: boolean): ResultAsync<void, AppError> => {
		return gitCommands.worktree_remove.invoke<void>({
			worktreePath,
			force: force ?? false,
		});
	},

	worktreeReset: (worktreePath: string): ResultAsync<void, AppError> => {
		return gitCommands.worktree_reset.invoke<void>({ worktreePath });
	},

	worktreeList: (projectPath: string): ResultAsync<WorktreeInfo[], AppError> => {
		return gitCommands.worktree_list.invoke<WorktreeInfo[]>({ projectPath });
	},

	worktreeRename: (worktreePath: string, newName: string): ResultAsync<WorktreeInfo, AppError> => {
		return gitCommands.worktree_rename.invoke<WorktreeInfo>({ worktreePath, newName });
	},

	worktreeDiskSize: (path: string): ResultAsync<number, AppError> => {
		return gitCommands.worktree_disk_size.invoke<number>({ path });
	},

	// ─── Git Panel Operations ───────────────────────────────────────────

	panelStatus: (projectPath: string): ResultAsync<GitPanelFileStatus[], AppError> => {
		return gitCommands.panel_status.invoke<GitPanelFileStatus[]>({ projectPath });
	},

	diffStats: (projectPath: string): ResultAsync<GitDiffStats, AppError> => {
		return gitCommands.diff_stats.invoke<GitDiffStats>({ projectPath });
	},

	stageFiles: (projectPath: string, files: string[]): ResultAsync<void, AppError> => {
		return gitCommands.stage_files.invoke<void>({ projectPath, files });
	},

	unstageFiles: (projectPath: string, files: string[]): ResultAsync<void, AppError> => {
		return gitCommands.unstage_files.invoke<void>({ projectPath, files });
	},

	stageAll: (projectPath: string): ResultAsync<void, AppError> => {
		return gitCommands.stage_all.invoke<void>({ projectPath });
	},

	discardChanges: (projectPath: string, files: string[]): ResultAsync<void, AppError> => {
		return gitCommands.discard_changes.invoke<void>({ projectPath, files });
	},

	commit: (projectPath: string, message: string): ResultAsync<GitCommitResult, AppError> => {
		return gitCommands.commit.invoke<GitCommitResult>({ projectPath, message });
	},

	push: (projectPath: string): ResultAsync<void, AppError> => {
		return gitCommands.push.invoke<void>({ projectPath });
	},

	pull: (projectPath: string): ResultAsync<void, AppError> => {
		return gitCommands.pull.invoke<void>({ projectPath });
	},

	fetch: (projectPath: string): ResultAsync<void, AppError> => {
		return gitCommands.fetch.invoke<void>({ projectPath });
	},

	remoteStatus: (projectPath: string): ResultAsync<GitRemoteStatus, AppError> => {
		return gitCommands.remote_status.invoke<GitRemoteStatus>({ projectPath });
	},

	stashList: (projectPath: string): ResultAsync<GitStashEntry[], AppError> => {
		return gitCommands.stash_list.invoke<GitStashEntry[]>({ projectPath });
	},

	stashPop: (projectPath: string, index: number): ResultAsync<void, AppError> => {
		return gitCommands.stash_pop.invoke<void>({ projectPath, index });
	},

	stashDrop: (projectPath: string, index: number): ResultAsync<void, AppError> => {
		return gitCommands.stash_drop.invoke<void>({ projectPath, index });
	},

	stashSave: (projectPath: string, message?: string): ResultAsync<void, AppError> => {
		return gitCommands.stash_save.invoke<void>({ projectPath, message });
	},

	log: (projectPath: string, limit = 50): ResultAsync<GitLogEntry[], AppError> => {
		return gitCommands.log.invoke<GitLogEntry[]>({ projectPath, limit });
	},

	createBranch: (
		projectPath: string,
		name: string,
		startPoint?: string
	): ResultAsync<string, AppError> => {
		return gitCommands.create_branch.invoke<string>({ projectPath, name, startPoint });
	},

	deleteBranch: (projectPath: string, name: string, force = false): ResultAsync<void, AppError> => {
		return gitCommands.delete_branch.invoke<void>({ projectPath, name, force });
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
		prBody?: string
	): ResultAsync<GitStackedActionResult, AppError> => {
		return gitCommands.run_stacked_action.invoke<GitStackedActionResult>({
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
		customInstructions?: string
	): ResultAsync<ShipContext | null, AppError> => {
		return gitCommands.collect_ship_context.invoke<ShipContext | null>({
			projectPath,
			customInstructions,
		});
	},

	prDetails: (projectPath: string, prNumber: number): ResultAsync<PrDetails, AppError> => {
		return gitCommands.pr_details.invoke<PrDetails>({ projectPath, prNumber });
	},

	mergePr: (
		projectPath: string,
		prNumber: number,
		strategy: MergeStrategy
	): ResultAsync<void, AppError> => {
		return gitCommands.merge_pr.invoke<void>({ projectPath, prNumber, strategy });
	},

	getOpenPrForBranch: (projectPath: string): ResultAsync<OpenPrInfo | null, AppError> => {
		return gitCommands.get_open_pr_for_branch.invoke<OpenPrInfo | null>({ projectPath });
	},

	// ─── Git HEAD Watcher ──────────────────────────────────────────────

	watchHead: (projectPath: string): ResultAsync<void, AppError> => {
		return gitCommands.watch_head.invoke<void>({ projectPath });
	},

	loadWorktreeConfig: (projectPath: string): ResultAsync<WorktreeConfig | null, AppError> => {
		return gitCommands.load_worktree_config.invoke<WorktreeConfig | null>({ projectPath });
	},

	runWorktreeSetup: (
		worktreePath: string,
		projectPath: string
	): ResultAsync<SetupResult, AppError> => {
		return gitCommands.run_worktree_setup.invoke<SetupResult>({ worktreePath, projectPath });
	},

	saveWorktreeConfig: (
		projectPath: string,
		setupScript: string
	): ResultAsync<void, AppError> => {
		return gitCommands.save_worktree_config.invoke<void>({ projectPath, setupScript });
	},
};

// ─── Types (matching Rust structs from git/operations.rs) ───────────────

export interface GitPanelFileStatus {
	path: string;
	indexStatus: string | null;
	worktreeStatus: string | null;
	indexInsertions: number;
	indexDeletions: number;
	worktreeInsertions: number;
	worktreeDeletions: number;
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

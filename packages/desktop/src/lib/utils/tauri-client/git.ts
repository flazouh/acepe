import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import type { CloneResult } from "../../acp/types/index.js";
import type { SetupResult, WorktreeConfig } from "../../acp/types/worktree-config.js";
import type { PreparedWorktreeLaunch, WorktreeInfo } from "../../acp/types/worktree-info.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import { unsupportedOnContract } from "./rpc-bridge.ts";

const gitCommands = TAURI_COMMAND_CLIENT.git;

// clone/browseDestination/worktreeCreate/worktreeReset/worktreeRename/
// worktreeDiskSize/diffStats/stashSave/createBranch/deleteBranch/
// getOpenPrForBranch have no live caller today (see #249 batch 2 map); each
// moves to unsupportedOnContract below with its own note.
//
// The other 33 methods (init through saveWorktreeConfig) all have live
// callers -- git-panel.svelte, agent-panel-ship-workflow.ts,
// branch-picker.svelte, project-selection-panel.svelte,
// worktree-setup-orchestrator.ts, and others -- and stay on
// TAURI_COMMAND_CLIENT this slice. packages/server/src/git/makeGitService.ts's
// GitService already implements almost all of that logic server-side
// (isRepo/init/branches/worktrees/stage/commit/push/pull/fetch/stash/log/PR/
// CI/ship-context): it already backs the git.status.refresh/diff.load/
// blame.load/hunk.accept/hunk.reject dispatch commands the review workspace
// uses to build its event-sourced gitReview snapshot. But these 33 methods
// are one-shot request/response calls -- git-panel.svelte reads a direct
// return value, e.g. `const result = await ... git.commit(...)` -- not state
// that belongs projected into gitReview. Routing them through the
// dispatch/decider/event pipeline would mean rewriting every call site to
// poll a snapshot instead of awaiting a value, which breaks the
// "component call sites untouched" rule batch 1 established. The right fit
// is the utility-RPC pattern (getProjectIndex/readTextFile/writeTextFile/
// getDefaultShell): a named Rpc.make primitive per operation, hand-wired
// through RPC_PRIMITIVE_TAGS, AcepeRpc's RpcGroup.make, and the exhaustive
// per-primitive Exit/electrobun-schema blocks in
// packages/contracts/src/rpc.ts, plus the server handlers and the electrobun
// bridge. That machinery is intentionally small today (3 primitives added
// across 2 prior slices); porting all 33 live git.ts methods means ~33 new
// primitives across that hand-enumerated wiring, which is out of scope for
// one slice. A follow-up should split this by sub-domain rather than one
// big-bang: branch/checkout, stage/commit, push/pull/fetch/remote-status,
// stash, worktree lifecycle (create/remove/list/rename/reset/disk-size/
// prepare-launch), worktree-config/setup, and ship/PR/CI. See the #249 issue
// thread.
export const git = {
	// No live caller today (see #249 batch 2 map); the clone-a-new-project
	// flow that used this is dormant. GitService.clone already exists
	// server-side (makeGitService.ts) but has no RPC wiring yet.
	clone: (
		_url: string,
		_destination: string,
		_branch?: string
	): Effect.Effect<CloneResult, AppError> => {
		return unsupportedOnContract("git.clone");
	},

	// Native OS "choose a folder" dialog for the dormant clone flow above; no
	// live caller and no TS/RPC concept of a file-system picker dialog today.
	browseDestination: (): Effect.Effect<string | null, AppError> => {
		return unsupportedOnContract("git.browseDestination");
	},

	init: (projectPath: string): Effect.Effect<void, AppError> => {
		return gitCommands.init.invoke<void>({ projectPath });
	},

	isRepo: (projectPath: string): Effect.Effect<boolean, AppError> => {
		return gitCommands.is_repo.invoke<boolean>({ projectPath });
	},

	currentBranch: (projectPath: string): Effect.Effect<string, AppError> => {
		return gitCommands.current_branch.invoke<string>({ projectPath });
	},

	listBranches: (projectPath: string): Effect.Effect<string[], AppError> => {
		return gitCommands.list_branches.invoke<string[]>({ projectPath });
	},

	checkoutBranch: (
		projectPath: string,
		branch: string,
		create = false
	): Effect.Effect<string, AppError> => {
		return gitCommands.checkout_branch.invoke<string>({ projectPath, branch, create });
	},

	hasUncommittedChanges: (projectPath: string): Effect.Effect<boolean, AppError> => {
		return gitCommands.has_uncommitted_changes.invoke<boolean>({ projectPath });
	},

	// No live caller today (see #249 batch 2 map); worktree creation goes
	// through prepareWorktreeSessionLaunch below instead.
	worktreeCreate: (_projectPath: string): Effect.Effect<WorktreeInfo, AppError> => {
		return unsupportedOnContract("git.worktreeCreate");
	},

	prepareWorktreeSessionLaunch: (
		projectPath: string,
		agentId: string
	): Effect.Effect<PreparedWorktreeLaunch, AppError> => {
		return gitCommands.prepare_worktree_session_launch.invoke<PreparedWorktreeLaunch>({
			projectPath,
			agentId,
		});
	},

	discardPreparedWorktreeSessionLaunch: (
		launchToken: string,
		removeWorktree = false
	): Effect.Effect<void, AppError> => {
		return gitCommands.discard_prepared_worktree_session_launch.invoke<void>({
			launchToken,
			removeWorktree,
		});
	},

	worktreeRemove: (worktreePath: string, force?: boolean): Effect.Effect<void, AppError> => {
		return gitCommands.worktree_remove.invoke<void>({
			worktreePath,
			force: force ?? false,
		});
	},

	// No live caller today (see #249 batch 2 map); worktree reset has no UI
	// affordance wired up.
	worktreeReset: (_worktreePath: string): Effect.Effect<void, AppError> => {
		return unsupportedOnContract("git.worktreeReset");
	},

	worktreeList: (projectPath: string): Effect.Effect<WorktreeInfo[], AppError> => {
		return gitCommands.worktree_list.invoke<WorktreeInfo[]>({ projectPath });
	},

	// No live caller today (see #249 batch 2 map); worktree rename has no UI
	// affordance wired up.
	worktreeRename: (
		_worktreePath: string,
		_newName: string
	): Effect.Effect<WorktreeInfo, AppError> => {
		return unsupportedOnContract("git.worktreeRename");
	},

	// No live caller today (see #249 batch 2 map); disk-size display has no UI
	// affordance wired up.
	worktreeDiskSize: (_path: string): Effect.Effect<number, AppError> => {
		return unsupportedOnContract("git.worktreeDiskSize");
	},

	// ─── Git Panel Operations ───────────────────────────────────────────

	panelStatus: (projectPath: string): Effect.Effect<GitPanelFileStatus[], AppError> => {
		return gitCommands.panel_status.invoke<GitPanelFileStatus[]>({ projectPath });
	},

	// No live caller today (see #249 batch 2 map); git-panel.svelte derives its
	// insertion/deletion totals from panelStatus's per-file counts instead.
	diffStats: (_projectPath: string): Effect.Effect<GitDiffStats, AppError> => {
		return unsupportedOnContract("git.diffStats");
	},

	stageFiles: (projectPath: string, files: string[]): Effect.Effect<void, AppError> => {
		return gitCommands.stage_files.invoke<void>({ projectPath, files });
	},

	unstageFiles: (projectPath: string, files: string[]): Effect.Effect<void, AppError> => {
		return gitCommands.unstage_files.invoke<void>({ projectPath, files });
	},

	stageAll: (projectPath: string): Effect.Effect<void, AppError> => {
		return gitCommands.stage_all.invoke<void>({ projectPath });
	},

	discardChanges: (projectPath: string, files: string[]): Effect.Effect<void, AppError> => {
		return gitCommands.discard_changes.invoke<void>({ projectPath, files });
	},

	commit: (projectPath: string, message: string): Effect.Effect<GitCommitResult, AppError> => {
		return gitCommands.commit.invoke<GitCommitResult>({ projectPath, message });
	},

	push: (projectPath: string): Effect.Effect<void, AppError> => {
		return gitCommands.push.invoke<void>({ projectPath });
	},

	pull: (projectPath: string): Effect.Effect<void, AppError> => {
		return gitCommands.pull.invoke<void>({ projectPath });
	},

	fetch: (projectPath: string): Effect.Effect<void, AppError> => {
		return gitCommands.fetch.invoke<void>({ projectPath });
	},

	remoteStatus: (projectPath: string): Effect.Effect<GitRemoteStatus, AppError> => {
		return gitCommands.remote_status.invoke<GitRemoteStatus>({ projectPath });
	},

	stashList: (projectPath: string): Effect.Effect<GitStashEntry[], AppError> => {
		return gitCommands.stash_list.invoke<GitStashEntry[]>({ projectPath });
	},

	stashPop: (projectPath: string, index: number): Effect.Effect<void, AppError> => {
		return gitCommands.stash_pop.invoke<void>({ projectPath, index });
	},

	stashDrop: (projectPath: string, index: number): Effect.Effect<void, AppError> => {
		return gitCommands.stash_drop.invoke<void>({ projectPath, index });
	},

	// No live caller today (see #249 batch 2 map); git-panel.svelte only
	// lists/pops/drops stashes, it never creates one.
	stashSave: (_projectPath: string, _message?: string): Effect.Effect<void, AppError> => {
		return unsupportedOnContract("git.stashSave");
	},

	log: (projectPath: string, limit = 50): Effect.Effect<GitLogEntry[], AppError> => {
		return gitCommands.log.invoke<GitLogEntry[]>({ projectPath, limit });
	},

	// No live caller today (see #249 batch 2 map); branch-picker.svelte creates
	// branches through checkoutBranch's create flag instead.
	createBranch: (
		_projectPath: string,
		_name: string,
		_startPoint?: string
	): Effect.Effect<string, AppError> => {
		return unsupportedOnContract("git.createBranch");
	},

	// No live caller today (see #249 batch 2 map); branch deletion has no UI
	// affordance wired up.
	deleteBranch: (
		_projectPath: string,
		_name: string,
		_force = false
	): Effect.Effect<void, AppError> => {
		return unsupportedOnContract("git.deleteBranch");
	},

	/**
	 * Runs commit, then optionally push and create/open PR in one Tauri call.
	 * Use "commit" for local-only; "commit_push" to also push; "commit_push_pr" to push and create or open a PR.
	 *
	 * @param projectPath - Path to the git project root.
	 * @param action - "commit" | "commit_push" | "commit_push_pr"
	 * @param commitMessage - Message for the commit.
	 * @returns Effect resolving to per-step result (commit, push, pr).
	 */
	runStackedAction: (
		projectPath: string,
		action: GitStackedAction,
		commitMessage: string,
		prTitle?: string,
		prBody?: string
	): Effect.Effect<GitStackedActionResult, AppError> => {
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
	): Effect.Effect<ShipContext | null, AppError> => {
		return gitCommands.collect_ship_context.invoke<ShipContext | null>({
			projectPath,
			customInstructions,
		});
	},

	prDetails: (projectPath: string, prNumber: number): Effect.Effect<PrDetails, AppError> => {
		return gitCommands.pr_details.invoke<PrDetails>({ projectPath, prNumber });
	},

	prChecks: (projectPath: string, prNumber: number): Effect.Effect<PrChecks, AppError> => {
		return gitCommands.pr_checks.invoke<PrChecks>({ projectPath, prNumber });
	},

	mergePr: (
		projectPath: string,
		prNumber: number,
		strategy: MergeStrategy
	): Effect.Effect<void, AppError> => {
		return gitCommands.merge_pr.invoke<void>({ projectPath, prNumber, strategy });
	},

	// No live caller today (see #249 batch 2 map); pr-link-state-store gets its
	// open-PR info from prDetails/prChecks once a PR is linked instead.
	getOpenPrForBranch: (_projectPath: string): Effect.Effect<OpenPrInfo | null, AppError> => {
		return unsupportedOnContract("git.getOpenPrForBranch");
	},

	ciJobDetails: (projectPath: string, detailsUrl: string): Effect.Effect<CiJobDetails, AppError> => {
		return gitCommands.ci_job_details.invoke<CiJobDetails>({ projectPath, detailsUrl });
	},

	// ─── Git HEAD Watcher ──────────────────────────────────────────────

	watchHead: (projectPath: string): Effect.Effect<void, AppError> => {
		return gitCommands.watch_head.invoke<void>({ projectPath });
	},

	loadWorktreeConfig: (projectPath: string): Effect.Effect<WorktreeConfig | null, AppError> => {
		return gitCommands.load_worktree_config.invoke<WorktreeConfig | null>({ projectPath });
	},

	runWorktreeSetup: (
		worktreePath: string,
		projectPath: string
	): Effect.Effect<SetupResult, AppError> => {
		return gitCommands.run_worktree_setup.invoke<SetupResult>({ worktreePath, projectPath });
	},

	saveWorktreeConfig: (
		projectPath: string,
		setupCommands: string[]
	): Effect.Effect<void, AppError> => {
		return gitCommands.save_worktree_config.invoke<void>({ projectPath, setupCommands });
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

export type PrCheckStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "UNKNOWN";

export type PrCheckConclusion =
	| "SUCCESS"
	| "FAILURE"
	| "NEUTRAL"
	| "CANCELLED"
	| "SKIPPED"
	| "TIMED_OUT"
	| "ACTION_REQUIRED"
	| "STALE"
	| "STARTUP_FAILURE"
	| "UNKNOWN";

export interface PrCheckRun {
	name: string;
	status: PrCheckStatus;
	conclusion: PrCheckConclusion | null;
	detailsUrl: string | null;
	startedAt: string | null;
	completedAt: string | null;
	workflowName: string | null;
}

export interface PrChecks {
	prNumber: number;
	headSha: string;
	checkRuns: PrCheckRun[];
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

export interface CiJobStep {
	number: number;
	name: string;
	status: string;
	conclusion: string | null;
	log: string;
}

export interface CiJobDetails {
	id: number;
	name: string;
	status: string;
	conclusion: string | null;
	steps: CiJobStep[];
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

import type { GitCallResult } from "@acepe/contracts";
import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import type { CloneResult } from "../../acp/types/index.js";
import type { SetupResult, WorktreeConfig } from "../../acp/types/worktree-config.js";
import type { PreparedWorktreeLaunch, WorktreeInfo } from "../../acp/types/worktree-info.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import { unsupportedOnContract, withRpcClient } from "./rpc-bridge.ts";

const gitCommands = TAURI_COMMAND_CLIENT.git;

// The gitCall result union echoes the request's `op` discriminant (see
// packages/contracts/src/gitCall.ts), but TypeScript can't statically tie a
// gitCall() call's request op to its response type -- this narrows it at
// runtime. A mismatch here means the server routed the request to the wrong
// branch, which is a wiring bug, not a request the caller can recover from,
// so it's a defect rather than a typed AppError.
const unwrapGitCallResult = <Tag extends GitCallResult["op"]>(
	tag: Tag,
	result: GitCallResult
): Effect.Effect<Extract<GitCallResult, { op: Tag }>, AppError> =>
	result.op === tag
		? Effect.succeed(result as Extract<GitCallResult, { op: Tag }>)
		: Effect.die(new Error(`gitCall: expected op '${tag}', got '${result.op}'`));

// clone/browseDestination/worktreeCreate/worktreeReset/worktreeRename/
// worktreeDiskSize/diffStats/stashSave/createBranch/deleteBranch/
// getOpenPrForBranch have no live caller today (see #249 batch 2 map); each
// moves to unsupportedOnContract below with its own note.
//
// init/isRepo/currentBranch/listBranches/checkoutBranch/
// hasUncommittedChanges (branch/checkout), panelStatus/stageFiles/
// unstageFiles/stageAll/discardChanges/commit/log (stage/commit),
// push/pull/fetch/remoteStatus (push/pull/remote), stashList/stashPop/
// stashDrop (stash), and prepareWorktreeSessionLaunch/
// discardPreparedWorktreeSessionLaunch/worktreeRemove/worktreeList/
// loadWorktreeConfig/saveWorktreeConfig/runWorktreeSetup (worktree
// lifecycle/config) ride the gitCall utility RPC
// (packages/contracts/src/gitCall.ts) -- a tagged-union request/response
// pair routed server-side onto GitService
// (packages/server/src/git/gitCallHandler.ts), per the #249 issue thread's
// DESIGN DECISION. Growing that union by sub-domain adds zero new RPC
// primitives after the first.
//
// The remaining 6 methods (runStackedAction, collectShipContext, prDetails,
// prChecks, mergePr, ciJobDetails -- the ship/PR/CI sub-domain) plus
// watchHead still have live callers -- agent-panel-ship-workflow.ts,
// agent-panel.svelte, modified-files-header.svelte, pr-link-state-
// store.svelte.ts, and others -- and stay on TAURI_COMMAND_CLIENT.
// packages/server/src/git/makeGitService.ts's GitService already
// implements almost all of the ship/PR/CI logic server-side too; a
// follow-up slice should grow the gitCall union to carry it. watchHead is
// different in kind, not just remaining scope: it is a Stream (GitService.
// watchHead returns Stream.Stream, polling for HEAD changes), and gitCall
// is a plain one-shot request/response RPC (see rpc.ts's GitCall, which has
// no `stream: true`), so it cannot ride this union without a second RPC
// primitive -- out of scope for the gitCall-union slices per the #249
// issue thread's DESIGN DECISION.
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
		return withRpcClient("git.init", (client) =>
			client.gitCall({ op: "git.init", projectPath })
		).pipe(Effect.asVoid);
	},

	isRepo: (projectPath: string): Effect.Effect<boolean, AppError> => {
		return withRpcClient("git.isRepo", (client) =>
			client.gitCall({ op: "git.isRepo", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.isRepo", result)),
			Effect.map((result) => result.isRepo)
		);
	},

	currentBranch: (projectPath: string): Effect.Effect<string, AppError> => {
		return withRpcClient("git.currentBranch", (client) =>
			client.gitCall({ op: "git.currentBranch", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.currentBranch", result)),
			Effect.map((result) => result.branch)
		);
	},

	listBranches: (projectPath: string): Effect.Effect<string[], AppError> => {
		return withRpcClient("git.listBranches", (client) =>
			client.gitCall({ op: "git.listBranches", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.listBranches", result)),
			Effect.map((result) => [...result.branches])
		);
	},

	checkoutBranch: (
		projectPath: string,
		branch: string,
		create = false
	): Effect.Effect<string, AppError> => {
		return withRpcClient("git.checkoutBranch", (client) =>
			client.gitCall({ op: "git.checkoutBranch", projectPath, branch, create })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.checkoutBranch", result)),
			Effect.map((result) => result.branch)
		);
	},

	hasUncommittedChanges: (projectPath: string): Effect.Effect<boolean, AppError> => {
		return withRpcClient("git.hasUncommittedChanges", (client) =>
			client.gitCall({ op: "git.hasUncommittedChanges", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.hasUncommittedChanges", result)),
			Effect.map((result) => result.hasUncommittedChanges)
		);
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
		return withRpcClient("git.prepareWorktreeSessionLaunch", (client) =>
			client.gitCall({ op: "git.prepareWorktreeSessionLaunch", projectPath, agentId })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.prepareWorktreeSessionLaunch", result)),
			Effect.map((result) => result.launch)
		);
	},

	discardPreparedWorktreeSessionLaunch: (
		launchToken: string,
		removeWorktree = false
	): Effect.Effect<void, AppError> => {
		return withRpcClient("git.discardPreparedWorktreeSessionLaunch", (client) =>
			client.gitCall({
				op: "git.discardPreparedWorktreeSessionLaunch",
				launchToken,
				removeWorktree,
			})
		).pipe(Effect.asVoid);
	},

	worktreeRemove: (worktreePath: string, force?: boolean): Effect.Effect<void, AppError> => {
		return withRpcClient("git.worktreeRemove", (client) =>
			client.gitCall({ op: "git.worktreeRemove", worktreePath, force: force ?? false })
		).pipe(Effect.asVoid);
	},

	// No live caller today (see #249 batch 2 map); worktree reset has no UI
	// affordance wired up.
	worktreeReset: (_worktreePath: string): Effect.Effect<void, AppError> => {
		return unsupportedOnContract("git.worktreeReset");
	},

	worktreeList: (projectPath: string): Effect.Effect<WorktreeInfo[], AppError> => {
		return withRpcClient("git.worktreeList", (client) =>
			client.gitCall({ op: "git.worktreeList", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.worktreeList", result)),
			Effect.map((result) => [...result.worktrees])
		);
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
		return withRpcClient("git.panelStatus", (client) =>
			client.gitCall({ op: "git.panelStatus", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.panelStatus", result)),
			Effect.map((result) => [...result.files])
		);
	},

	// No live caller today (see #249 batch 2 map); git-panel.svelte derives its
	// insertion/deletion totals from panelStatus's per-file counts instead.
	diffStats: (_projectPath: string): Effect.Effect<GitDiffStats, AppError> => {
		return unsupportedOnContract("git.diffStats");
	},

	stageFiles: (projectPath: string, files: string[]): Effect.Effect<void, AppError> => {
		return withRpcClient("git.stageFiles", (client) =>
			client.gitCall({ op: "git.stageFiles", projectPath, files })
		).pipe(Effect.asVoid);
	},

	unstageFiles: (projectPath: string, files: string[]): Effect.Effect<void, AppError> => {
		return withRpcClient("git.unstageFiles", (client) =>
			client.gitCall({ op: "git.unstageFiles", projectPath, files })
		).pipe(Effect.asVoid);
	},

	stageAll: (projectPath: string): Effect.Effect<void, AppError> => {
		return withRpcClient("git.stageAll", (client) =>
			client.gitCall({ op: "git.stageAll", projectPath })
		).pipe(Effect.asVoid);
	},

	discardChanges: (projectPath: string, files: string[]): Effect.Effect<void, AppError> => {
		return withRpcClient("git.discardChanges", (client) =>
			client.gitCall({ op: "git.discardChanges", projectPath, files })
		).pipe(Effect.asVoid);
	},

	commit: (projectPath: string, message: string): Effect.Effect<GitCommitResult, AppError> => {
		return withRpcClient("git.commit", (client) =>
			client.gitCall({ op: "git.commit", projectPath, message })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.commit", result)),
			Effect.map((result) => ({ sha: result.sha, shortSha: result.shortSha }))
		);
	},

	push: (projectPath: string): Effect.Effect<void, AppError> => {
		return withRpcClient("git.push", (client) =>
			client.gitCall({ op: "git.push", projectPath })
		).pipe(Effect.asVoid);
	},

	pull: (projectPath: string): Effect.Effect<void, AppError> => {
		return withRpcClient("git.pull", (client) =>
			client.gitCall({ op: "git.pull", projectPath })
		).pipe(Effect.asVoid);
	},

	fetch: (projectPath: string): Effect.Effect<void, AppError> => {
		return withRpcClient("git.fetch", (client) =>
			client.gitCall({ op: "git.fetch", projectPath })
		).pipe(Effect.asVoid);
	},

	remoteStatus: (projectPath: string): Effect.Effect<GitRemoteStatus, AppError> => {
		return withRpcClient("git.remoteStatus", (client) =>
			client.gitCall({ op: "git.remoteStatus", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.remoteStatus", result)),
			Effect.map((result) => ({
				ahead: result.ahead,
				behind: result.behind,
				remote: result.remote,
				trackingBranch: result.trackingBranch
			}))
		);
	},

	stashList: (projectPath: string): Effect.Effect<GitStashEntry[], AppError> => {
		return withRpcClient("git.stashList", (client) =>
			client.gitCall({ op: "git.stashList", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.stashList", result)),
			Effect.map((result) => [...result.entries])
		);
	},

	stashPop: (projectPath: string, index: number): Effect.Effect<void, AppError> => {
		return withRpcClient("git.stashPop", (client) =>
			client.gitCall({ op: "git.stashPop", projectPath, index })
		).pipe(Effect.asVoid);
	},

	stashDrop: (projectPath: string, index: number): Effect.Effect<void, AppError> => {
		return withRpcClient("git.stashDrop", (client) =>
			client.gitCall({ op: "git.stashDrop", projectPath, index })
		).pipe(Effect.asVoid);
	},

	// No live caller today (see #249 batch 2 map); git-panel.svelte only
	// lists/pops/drops stashes, it never creates one.
	stashSave: (_projectPath: string, _message?: string): Effect.Effect<void, AppError> => {
		return unsupportedOnContract("git.stashSave");
	},

	log: (projectPath: string, limit = 50): Effect.Effect<GitLogEntry[], AppError> => {
		return withRpcClient("git.log", (client) =>
			client.gitCall({ op: "git.log", projectPath, limit })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.log", result)),
			Effect.map((result) => [...result.entries])
		);
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
		return withRpcClient("git.loadWorktreeConfig", (client) =>
			client.gitCall({ op: "git.loadWorktreeConfig", projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.loadWorktreeConfig", result)),
			Effect.map((result) =>
				result.config === null ? null : { setupCommands: [...result.config.setupCommands] }
			)
		);
	},

	// gitCall's git.runWorktreeSetup result mirrors GitService's SetupResult
	// shape (outputs/success/error), which differs from this facade's
	// long-standing SetupResult type (commandsRun/output, and a per-command
	// success flag) -- worktree-setup-orchestrator.ts reads commandsRun/
	// success/error off the return value, so this maps shapes rather than
	// changing the facade's signature.
	runWorktreeSetup: (
		worktreePath: string,
		projectPath: string
	): Effect.Effect<SetupResult, AppError> => {
		return withRpcClient("git.runWorktreeSetup", (client) =>
			client.gitCall({ op: "git.runWorktreeSetup", worktreePath, projectPath })
		).pipe(
			Effect.flatMap((result) => unwrapGitCallResult("git.runWorktreeSetup", result)),
			Effect.map(({ result }) => ({
				success: result.success,
				commandsRun: result.outputs.length,
				error: result.error,
				output: result.outputs.map((entry) => ({
					command: entry.command,
					success: entry.exitCode === 0,
					stdout: entry.stdout,
					stderr: entry.stderr,
					exitCode: entry.exitCode,
				})),
			}))
		);
	},

	saveWorktreeConfig: (
		projectPath: string,
		setupCommands: string[]
	): Effect.Effect<void, AppError> => {
		return withRpcClient("git.saveWorktreeConfig", (client) =>
			client.gitCall({ op: "git.saveWorktreeConfig", projectPath, setupCommands })
		).pipe(Effect.asVoid);
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

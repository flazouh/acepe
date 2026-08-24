import { TrimmedNonEmptyString } from "./baseSchemas.ts"
import * as Schema from "effect/Schema"

// The gitCall utility RPC (see rpc.ts). Request is a tagged union of
// per-operation payload structs discriminated on `op`; response is the
// matching tagged union discriminated the same way. Growing this union
// sub-domain by sub-domain (see the #249 issue thread's DESIGN DECISION
// comment) adds zero new RPC primitives after this one -- only new members
// of these two unions plus a routing branch on the server.
//
// This slice carries the branch/checkout, stage/commit, push/pull/
// remote-status, stash, and worktree lifecycle/config sub-domains of
// tauri-client/git.ts's 33 live methods. The ship/PR/CI sub-domain stays on
// TAURI_COMMAND_CLIENT and will grow this union in a later slice.

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const GitCallPanelFileStatus = Schema.Struct({
	path: Schema.String,
	indexStatus: Schema.NullOr(Schema.String),
	worktreeStatus: Schema.NullOr(Schema.String),
	indexInsertions: NonNegativeInt,
	indexDeletions: NonNegativeInt,
	worktreeInsertions: NonNegativeInt,
	worktreeDeletions: NonNegativeInt,
})
export type GitCallPanelFileStatus = typeof GitCallPanelFileStatus.Type

export const GitCallLogEntry = Schema.Struct({
	sha: Schema.String,
	shortSha: Schema.String,
	message: Schema.String,
	author: Schema.String,
	date: Schema.String,
})
export type GitCallLogEntry = typeof GitCallLogEntry.Type

// ─── branch/checkout ──────────────────────────────────────────────────────

export const GitCallInitRequest = Schema.Struct({
	op: Schema.Literal("git.init"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallInitRequest = typeof GitCallInitRequest.Type

export const GitCallInitResult = Schema.Struct({
	op: Schema.Literal("git.init"),
})
export type GitCallInitResult = typeof GitCallInitResult.Type

export const GitCallIsRepoRequest = Schema.Struct({
	op: Schema.Literal("git.isRepo"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallIsRepoRequest = typeof GitCallIsRepoRequest.Type

export const GitCallIsRepoResult = Schema.Struct({
	op: Schema.Literal("git.isRepo"),
	isRepo: Schema.Boolean,
})
export type GitCallIsRepoResult = typeof GitCallIsRepoResult.Type

export const GitCallCurrentBranchRequest = Schema.Struct({
	op: Schema.Literal("git.currentBranch"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallCurrentBranchRequest = typeof GitCallCurrentBranchRequest.Type

export const GitCallCurrentBranchResult = Schema.Struct({
	op: Schema.Literal("git.currentBranch"),
	branch: Schema.String,
})
export type GitCallCurrentBranchResult = typeof GitCallCurrentBranchResult.Type

export const GitCallListBranchesRequest = Schema.Struct({
	op: Schema.Literal("git.listBranches"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallListBranchesRequest = typeof GitCallListBranchesRequest.Type

export const GitCallListBranchesResult = Schema.Struct({
	op: Schema.Literal("git.listBranches"),
	branches: Schema.Array(Schema.String),
})
export type GitCallListBranchesResult = typeof GitCallListBranchesResult.Type

export const GitCallCheckoutBranchRequest = Schema.Struct({
	op: Schema.Literal("git.checkoutBranch"),
	projectPath: TrimmedNonEmptyString,
	branch: TrimmedNonEmptyString,
	create: Schema.optionalKey(Schema.Boolean),
})
export type GitCallCheckoutBranchRequest = typeof GitCallCheckoutBranchRequest.Type

export const GitCallCheckoutBranchResult = Schema.Struct({
	op: Schema.Literal("git.checkoutBranch"),
	branch: Schema.String,
})
export type GitCallCheckoutBranchResult = typeof GitCallCheckoutBranchResult.Type

export const GitCallHasUncommittedChangesRequest = Schema.Struct({
	op: Schema.Literal("git.hasUncommittedChanges"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallHasUncommittedChangesRequest = typeof GitCallHasUncommittedChangesRequest.Type

export const GitCallHasUncommittedChangesResult = Schema.Struct({
	op: Schema.Literal("git.hasUncommittedChanges"),
	hasUncommittedChanges: Schema.Boolean,
})
export type GitCallHasUncommittedChangesResult = typeof GitCallHasUncommittedChangesResult.Type

// ─── stage/commit ─────────────────────────────────────────────────────────

export const GitCallPanelStatusRequest = Schema.Struct({
	op: Schema.Literal("git.panelStatus"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallPanelStatusRequest = typeof GitCallPanelStatusRequest.Type

export const GitCallPanelStatusResult = Schema.Struct({
	op: Schema.Literal("git.panelStatus"),
	files: Schema.Array(GitCallPanelFileStatus),
})
export type GitCallPanelStatusResult = typeof GitCallPanelStatusResult.Type

export const GitCallStageFilesRequest = Schema.Struct({
	op: Schema.Literal("git.stageFiles"),
	projectPath: TrimmedNonEmptyString,
	files: Schema.Array(Schema.String),
})
export type GitCallStageFilesRequest = typeof GitCallStageFilesRequest.Type

export const GitCallStageFilesResult = Schema.Struct({
	op: Schema.Literal("git.stageFiles"),
})
export type GitCallStageFilesResult = typeof GitCallStageFilesResult.Type

export const GitCallUnstageFilesRequest = Schema.Struct({
	op: Schema.Literal("git.unstageFiles"),
	projectPath: TrimmedNonEmptyString,
	files: Schema.Array(Schema.String),
})
export type GitCallUnstageFilesRequest = typeof GitCallUnstageFilesRequest.Type

export const GitCallUnstageFilesResult = Schema.Struct({
	op: Schema.Literal("git.unstageFiles"),
})
export type GitCallUnstageFilesResult = typeof GitCallUnstageFilesResult.Type

export const GitCallStageAllRequest = Schema.Struct({
	op: Schema.Literal("git.stageAll"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallStageAllRequest = typeof GitCallStageAllRequest.Type

export const GitCallStageAllResult = Schema.Struct({
	op: Schema.Literal("git.stageAll"),
})
export type GitCallStageAllResult = typeof GitCallStageAllResult.Type

export const GitCallDiscardChangesRequest = Schema.Struct({
	op: Schema.Literal("git.discardChanges"),
	projectPath: TrimmedNonEmptyString,
	files: Schema.Array(Schema.String),
})
export type GitCallDiscardChangesRequest = typeof GitCallDiscardChangesRequest.Type

export const GitCallDiscardChangesResult = Schema.Struct({
	op: Schema.Literal("git.discardChanges"),
})
export type GitCallDiscardChangesResult = typeof GitCallDiscardChangesResult.Type

export const GitCallCommitRequest = Schema.Struct({
	op: Schema.Literal("git.commit"),
	projectPath: TrimmedNonEmptyString,
	message: Schema.String,
})
export type GitCallCommitRequest = typeof GitCallCommitRequest.Type

export const GitCallCommitResult = Schema.Struct({
	op: Schema.Literal("git.commit"),
	sha: Schema.String,
	shortSha: Schema.String,
})
export type GitCallCommitResult = typeof GitCallCommitResult.Type

export const GitCallLogRequest = Schema.Struct({
	op: Schema.Literal("git.log"),
	projectPath: TrimmedNonEmptyString,
	limit: Schema.optionalKey(NonNegativeInt),
})
export type GitCallLogRequest = typeof GitCallLogRequest.Type

export const GitCallLogResult = Schema.Struct({
	op: Schema.Literal("git.log"),
	entries: Schema.Array(GitCallLogEntry),
})
export type GitCallLogResult = typeof GitCallLogResult.Type

// ─── push/pull/remote ─────────────────────────────────────────────────────

export const GitCallPushRequest = Schema.Struct({
	op: Schema.Literal("git.push"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallPushRequest = typeof GitCallPushRequest.Type

export const GitCallPushResult = Schema.Struct({
	op: Schema.Literal("git.push"),
})
export type GitCallPushResult = typeof GitCallPushResult.Type

export const GitCallPullRequest = Schema.Struct({
	op: Schema.Literal("git.pull"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallPullRequest = typeof GitCallPullRequest.Type

export const GitCallPullResult = Schema.Struct({
	op: Schema.Literal("git.pull"),
})
export type GitCallPullResult = typeof GitCallPullResult.Type

export const GitCallFetchRequest = Schema.Struct({
	op: Schema.Literal("git.fetch"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallFetchRequest = typeof GitCallFetchRequest.Type

export const GitCallFetchResult = Schema.Struct({
	op: Schema.Literal("git.fetch"),
})
export type GitCallFetchResult = typeof GitCallFetchResult.Type

export const GitCallRemoteStatusRequest = Schema.Struct({
	op: Schema.Literal("git.remoteStatus"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallRemoteStatusRequest = typeof GitCallRemoteStatusRequest.Type

export const GitCallRemoteStatusResult = Schema.Struct({
	op: Schema.Literal("git.remoteStatus"),
	ahead: NonNegativeInt,
	behind: NonNegativeInt,
	remote: Schema.String,
	trackingBranch: Schema.String,
})
export type GitCallRemoteStatusResult = typeof GitCallRemoteStatusResult.Type

// ─── stash ────────────────────────────────────────────────────────────────

export const GitCallStashEntry = Schema.Struct({
	index: NonNegativeInt,
	message: Schema.String,
	date: Schema.String,
})
export type GitCallStashEntry = typeof GitCallStashEntry.Type

export const GitCallStashListRequest = Schema.Struct({
	op: Schema.Literal("git.stashList"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallStashListRequest = typeof GitCallStashListRequest.Type

export const GitCallStashListResult = Schema.Struct({
	op: Schema.Literal("git.stashList"),
	entries: Schema.Array(GitCallStashEntry),
})
export type GitCallStashListResult = typeof GitCallStashListResult.Type

export const GitCallStashPopRequest = Schema.Struct({
	op: Schema.Literal("git.stashPop"),
	projectPath: TrimmedNonEmptyString,
	index: NonNegativeInt,
})
export type GitCallStashPopRequest = typeof GitCallStashPopRequest.Type

export const GitCallStashPopResult = Schema.Struct({
	op: Schema.Literal("git.stashPop"),
})
export type GitCallStashPopResult = typeof GitCallStashPopResult.Type

export const GitCallStashDropRequest = Schema.Struct({
	op: Schema.Literal("git.stashDrop"),
	projectPath: TrimmedNonEmptyString,
	index: NonNegativeInt,
})
export type GitCallStashDropRequest = typeof GitCallStashDropRequest.Type

export const GitCallStashDropResult = Schema.Struct({
	op: Schema.Literal("git.stashDrop"),
})
export type GitCallStashDropResult = typeof GitCallStashDropResult.Type

// ─── worktree lifecycle/config ─────────────────────────────────────────────

export const GitCallWorktreeOrigin = Schema.Literals(["acepe", "external"])
export type GitCallWorktreeOrigin = typeof GitCallWorktreeOrigin.Type

export const GitCallWorktreeInfo = Schema.Struct({
	name: Schema.String,
	branch: Schema.String,
	directory: Schema.String,
	origin: GitCallWorktreeOrigin,
})
export type GitCallWorktreeInfo = typeof GitCallWorktreeInfo.Type

export const GitCallWorktreeRemoveRequest = Schema.Struct({
	op: Schema.Literal("git.worktreeRemove"),
	worktreePath: TrimmedNonEmptyString,
	force: Schema.optionalKey(Schema.Boolean),
})
export type GitCallWorktreeRemoveRequest = typeof GitCallWorktreeRemoveRequest.Type

export const GitCallWorktreeRemoveResult = Schema.Struct({
	op: Schema.Literal("git.worktreeRemove"),
})
export type GitCallWorktreeRemoveResult = typeof GitCallWorktreeRemoveResult.Type

export const GitCallWorktreeListRequest = Schema.Struct({
	op: Schema.Literal("git.worktreeList"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallWorktreeListRequest = typeof GitCallWorktreeListRequest.Type

export const GitCallWorktreeListResult = Schema.Struct({
	op: Schema.Literal("git.worktreeList"),
	worktrees: Schema.Array(GitCallWorktreeInfo),
})
export type GitCallWorktreeListResult = typeof GitCallWorktreeListResult.Type

export const GitCallPreparedWorktreeLaunch = Schema.Struct({
	launchToken: Schema.String,
	sequenceId: Schema.Int,
	worktree: GitCallWorktreeInfo,
})
export type GitCallPreparedWorktreeLaunch = typeof GitCallPreparedWorktreeLaunch.Type

export const GitCallPrepareWorktreeSessionLaunchRequest = Schema.Struct({
	op: Schema.Literal("git.prepareWorktreeSessionLaunch"),
	projectPath: TrimmedNonEmptyString,
	agentId: TrimmedNonEmptyString,
})
export type GitCallPrepareWorktreeSessionLaunchRequest =
	typeof GitCallPrepareWorktreeSessionLaunchRequest.Type

export const GitCallPrepareWorktreeSessionLaunchResult = Schema.Struct({
	op: Schema.Literal("git.prepareWorktreeSessionLaunch"),
	launch: GitCallPreparedWorktreeLaunch,
})
export type GitCallPrepareWorktreeSessionLaunchResult =
	typeof GitCallPrepareWorktreeSessionLaunchResult.Type

export const GitCallDiscardPreparedWorktreeSessionLaunchRequest = Schema.Struct({
	op: Schema.Literal("git.discardPreparedWorktreeSessionLaunch"),
	launchToken: TrimmedNonEmptyString,
	removeWorktree: Schema.optionalKey(Schema.Boolean),
})
export type GitCallDiscardPreparedWorktreeSessionLaunchRequest =
	typeof GitCallDiscardPreparedWorktreeSessionLaunchRequest.Type

export const GitCallDiscardPreparedWorktreeSessionLaunchResult = Schema.Struct({
	op: Schema.Literal("git.discardPreparedWorktreeSessionLaunch"),
})
export type GitCallDiscardPreparedWorktreeSessionLaunchResult =
	typeof GitCallDiscardPreparedWorktreeSessionLaunchResult.Type

export const GitCallWorktreeConfig = Schema.Struct({
	setupCommands: Schema.Array(Schema.String),
})
export type GitCallWorktreeConfig = typeof GitCallWorktreeConfig.Type

export const GitCallLoadWorktreeConfigRequest = Schema.Struct({
	op: Schema.Literal("git.loadWorktreeConfig"),
	projectPath: TrimmedNonEmptyString,
})
export type GitCallLoadWorktreeConfigRequest = typeof GitCallLoadWorktreeConfigRequest.Type

export const GitCallLoadWorktreeConfigResult = Schema.Struct({
	op: Schema.Literal("git.loadWorktreeConfig"),
	config: Schema.NullOr(GitCallWorktreeConfig),
})
export type GitCallLoadWorktreeConfigResult = typeof GitCallLoadWorktreeConfigResult.Type

export const GitCallSaveWorktreeConfigRequest = Schema.Struct({
	op: Schema.Literal("git.saveWorktreeConfig"),
	projectPath: TrimmedNonEmptyString,
	setupCommands: Schema.Array(Schema.String),
})
export type GitCallSaveWorktreeConfigRequest = typeof GitCallSaveWorktreeConfigRequest.Type

export const GitCallSaveWorktreeConfigResult = Schema.Struct({
	op: Schema.Literal("git.saveWorktreeConfig"),
})
export type GitCallSaveWorktreeConfigResult = typeof GitCallSaveWorktreeConfigResult.Type

export const GitCallCommandOutput = Schema.Struct({
	command: Schema.String,
	stdout: Schema.String,
	stderr: Schema.String,
	exitCode: Schema.Int,
})
export type GitCallCommandOutput = typeof GitCallCommandOutput.Type

export const GitCallSetupResult = Schema.Struct({
	success: Schema.Boolean,
	outputs: Schema.Array(GitCallCommandOutput),
	error: Schema.NullOr(Schema.String),
})
export type GitCallSetupResult = typeof GitCallSetupResult.Type

export const GitCallRunWorktreeSetupRequest = Schema.Struct({
	op: Schema.Literal("git.runWorktreeSetup"),
	worktreePath: TrimmedNonEmptyString,
	projectPath: TrimmedNonEmptyString,
})
export type GitCallRunWorktreeSetupRequest = typeof GitCallRunWorktreeSetupRequest.Type

export const GitCallRunWorktreeSetupResult = Schema.Struct({
	op: Schema.Literal("git.runWorktreeSetup"),
	result: GitCallSetupResult,
})
export type GitCallRunWorktreeSetupResult = typeof GitCallRunWorktreeSetupResult.Type

// ─── unions ───────────────────────────────────────────────────────────────

export const GitCallRequest = Schema.Union([
	GitCallInitRequest,
	GitCallIsRepoRequest,
	GitCallCurrentBranchRequest,
	GitCallListBranchesRequest,
	GitCallCheckoutBranchRequest,
	GitCallHasUncommittedChangesRequest,
	GitCallPanelStatusRequest,
	GitCallStageFilesRequest,
	GitCallUnstageFilesRequest,
	GitCallStageAllRequest,
	GitCallDiscardChangesRequest,
	GitCallCommitRequest,
	GitCallLogRequest,
	GitCallPushRequest,
	GitCallPullRequest,
	GitCallFetchRequest,
	GitCallRemoteStatusRequest,
	GitCallStashListRequest,
	GitCallStashPopRequest,
	GitCallStashDropRequest,
	GitCallWorktreeRemoveRequest,
	GitCallWorktreeListRequest,
	GitCallPrepareWorktreeSessionLaunchRequest,
	GitCallDiscardPreparedWorktreeSessionLaunchRequest,
	GitCallLoadWorktreeConfigRequest,
	GitCallSaveWorktreeConfigRequest,
	GitCallRunWorktreeSetupRequest,
])
export type GitCallRequest = typeof GitCallRequest.Type

export const GitCallResult = Schema.Union([
	GitCallInitResult,
	GitCallIsRepoResult,
	GitCallCurrentBranchResult,
	GitCallListBranchesResult,
	GitCallCheckoutBranchResult,
	GitCallHasUncommittedChangesResult,
	GitCallPanelStatusResult,
	GitCallStageFilesResult,
	GitCallUnstageFilesResult,
	GitCallStageAllResult,
	GitCallDiscardChangesResult,
	GitCallCommitResult,
	GitCallLogResult,
	GitCallPushResult,
	GitCallPullResult,
	GitCallFetchResult,
	GitCallRemoteStatusResult,
	GitCallStashListResult,
	GitCallStashPopResult,
	GitCallStashDropResult,
	GitCallWorktreeRemoveResult,
	GitCallWorktreeListResult,
	GitCallPrepareWorktreeSessionLaunchResult,
	GitCallDiscardPreparedWorktreeSessionLaunchResult,
	GitCallLoadWorktreeConfigResult,
	GitCallSaveWorktreeConfigResult,
	GitCallRunWorktreeSetupResult,
])
export type GitCallResult = typeof GitCallResult.Type

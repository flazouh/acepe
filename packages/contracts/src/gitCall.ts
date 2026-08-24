import { TrimmedNonEmptyString } from "./baseSchemas.ts"
import * as Schema from "effect/Schema"

// The gitCall utility RPC (see rpc.ts). Request is a tagged union of
// per-operation payload structs discriminated on `op`; response is the
// matching tagged union discriminated the same way. Growing this union
// sub-domain by sub-domain (see the #249 issue thread's DESIGN DECISION
// comment) adds zero new RPC primitives after this one -- only new members
// of these two unions plus a routing branch on the server.
//
// This slice carries every live-caller sub-domain of tauri-client/git.ts's
// 33 methods: branch/checkout, stage/commit, push/pull/remote-status,
// stash, worktree lifecycle/config, and ship/PR/CI. watchHead (a Stream,
// not a one-shot request/response) and the handful of methods with no live
// caller today stay on TAURI_COMMAND_CLIENT -- see tauri-client/git.ts's
// header comment.

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

// ─── ship/PR/CI ─────────────────────────────────────────────────────────

export const GitCallStackedAction = Schema.Literals(["commit", "commit_push", "commit_push_pr"])
export type GitCallStackedAction = typeof GitCallStackedAction.Type

export const GitCallStackedCommitStep = Schema.Struct({
	status: Schema.Literals(["created", "skipped_no_changes"]),
	commitSha: Schema.optionalKey(Schema.String),
	subject: Schema.optionalKey(Schema.String),
})
export type GitCallStackedCommitStep = typeof GitCallStackedCommitStep.Type

export const GitCallStackedPushStep = Schema.Struct({
	status: Schema.Literals(["pushed", "skipped_not_requested"]),
	branch: Schema.optionalKey(Schema.String),
	upstreamBranch: Schema.optionalKey(Schema.String),
})
export type GitCallStackedPushStep = typeof GitCallStackedPushStep.Type

export const GitCallStackedPrStep = Schema.Struct({
	status: Schema.Literals(["created", "opened_existing", "skipped_not_requested"]),
	url: Schema.optionalKey(Schema.String),
	number: Schema.optionalKey(Schema.Int),
	title: Schema.optionalKey(Schema.String),
	baseBranch: Schema.optionalKey(Schema.String),
	headBranch: Schema.optionalKey(Schema.String),
})
export type GitCallStackedPrStep = typeof GitCallStackedPrStep.Type

export const GitCallStackedActionResult = Schema.Struct({
	action: GitCallStackedAction,
	commit: GitCallStackedCommitStep,
	push: GitCallStackedPushStep,
	pr: GitCallStackedPrStep,
})
export type GitCallStackedActionResult = typeof GitCallStackedActionResult.Type

export const GitCallRunStackedActionRequest = Schema.Struct({
	op: Schema.Literal("git.runStackedAction"),
	projectPath: TrimmedNonEmptyString,
	action: GitCallStackedAction,
	commitMessage: Schema.String,
	prTitle: Schema.optionalKey(Schema.String),
	prBody: Schema.optionalKey(Schema.String),
})
export type GitCallRunStackedActionRequest = typeof GitCallRunStackedActionRequest.Type

export const GitCallRunStackedActionResult = Schema.Struct({
	op: Schema.Literal("git.runStackedAction"),
	result: GitCallStackedActionResult,
})
export type GitCallRunStackedActionResult = typeof GitCallRunStackedActionResult.Type

export const GitCallShipContext = Schema.Struct({
	prompt: Schema.String,
	branch: Schema.String,
	stagedSummary: Schema.String,
})
export type GitCallShipContext = typeof GitCallShipContext.Type

export const GitCallCollectShipContextRequest = Schema.Struct({
	op: Schema.Literal("git.collectShipContext"),
	projectPath: TrimmedNonEmptyString,
	customInstructions: Schema.optionalKey(Schema.String),
})
export type GitCallCollectShipContextRequest = typeof GitCallCollectShipContextRequest.Type

export const GitCallCollectShipContextResult = Schema.Struct({
	op: Schema.Literal("git.collectShipContext"),
	context: Schema.NullOr(GitCallShipContext),
})
export type GitCallCollectShipContextResult = typeof GitCallCollectShipContextResult.Type

export const GitCallPrState = Schema.Literals(["OPEN", "CLOSED", "MERGED"])
export type GitCallPrState = typeof GitCallPrState.Type

export const GitCallPrCommit = Schema.Struct({
	oid: Schema.String,
	messageHeadline: Schema.String,
	additions: Schema.Int,
	deletions: Schema.Int,
})
export type GitCallPrCommit = typeof GitCallPrCommit.Type

export const GitCallPrDetails = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	body: Schema.String,
	state: GitCallPrState,
	url: Schema.String,
	isDraft: Schema.Boolean,
	additions: Schema.Int,
	deletions: Schema.Int,
	commits: Schema.Array(GitCallPrCommit),
})
export type GitCallPrDetails = typeof GitCallPrDetails.Type

export const GitCallPrDetailsRequest = Schema.Struct({
	op: Schema.Literal("git.prDetails"),
	projectPath: TrimmedNonEmptyString,
	prNumber: Schema.Int,
})
export type GitCallPrDetailsRequest = typeof GitCallPrDetailsRequest.Type

export const GitCallPrDetailsResult = Schema.Struct({
	op: Schema.Literal("git.prDetails"),
	details: GitCallPrDetails,
})
export type GitCallPrDetailsResult = typeof GitCallPrDetailsResult.Type

export const GitCallPrCheckStatus = Schema.Literals(["QUEUED", "IN_PROGRESS", "COMPLETED", "UNKNOWN"])
export type GitCallPrCheckStatus = typeof GitCallPrCheckStatus.Type

export const GitCallPrCheckConclusion = Schema.Literals([
	"SUCCESS",
	"FAILURE",
	"NEUTRAL",
	"CANCELLED",
	"SKIPPED",
	"TIMED_OUT",
	"ACTION_REQUIRED",
	"STALE",
	"STARTUP_FAILURE",
	"UNKNOWN",
])
export type GitCallPrCheckConclusion = typeof GitCallPrCheckConclusion.Type

export const GitCallPrCheckRun = Schema.Struct({
	name: Schema.String,
	status: GitCallPrCheckStatus,
	conclusion: Schema.NullOr(GitCallPrCheckConclusion),
	detailsUrl: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.String),
	completedAt: Schema.NullOr(Schema.String),
	workflowName: Schema.NullOr(Schema.String),
})
export type GitCallPrCheckRun = typeof GitCallPrCheckRun.Type

export const GitCallPrChecks = Schema.Struct({
	prNumber: Schema.Int,
	headSha: Schema.String,
	checkRuns: Schema.Array(GitCallPrCheckRun),
})
export type GitCallPrChecks = typeof GitCallPrChecks.Type

export const GitCallPrChecksRequest = Schema.Struct({
	op: Schema.Literal("git.prChecks"),
	projectPath: TrimmedNonEmptyString,
	prNumber: Schema.Int,
})
export type GitCallPrChecksRequest = typeof GitCallPrChecksRequest.Type

export const GitCallPrChecksResult = Schema.Struct({
	op: Schema.Literal("git.prChecks"),
	checks: GitCallPrChecks,
})
export type GitCallPrChecksResult = typeof GitCallPrChecksResult.Type

export const GitCallMergeStrategy = Schema.Literals(["squash", "merge", "rebase"])
export type GitCallMergeStrategy = typeof GitCallMergeStrategy.Type

export const GitCallMergePrRequest = Schema.Struct({
	op: Schema.Literal("git.mergePr"),
	projectPath: TrimmedNonEmptyString,
	prNumber: Schema.Int,
	strategy: GitCallMergeStrategy,
})
export type GitCallMergePrRequest = typeof GitCallMergePrRequest.Type

export const GitCallMergePrResult = Schema.Struct({
	op: Schema.Literal("git.mergePr"),
})
export type GitCallMergePrResult = typeof GitCallMergePrResult.Type

export const GitCallCiJobStep = Schema.Struct({
	number: Schema.Int,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	log: Schema.String,
})
export type GitCallCiJobStep = typeof GitCallCiJobStep.Type

export const GitCallCiJobDetails = Schema.Struct({
	id: Schema.Int,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	steps: Schema.Array(GitCallCiJobStep),
})
export type GitCallCiJobDetails = typeof GitCallCiJobDetails.Type

export const GitCallCiJobDetailsRequest = Schema.Struct({
	op: Schema.Literal("git.ciJobDetails"),
	projectPath: TrimmedNonEmptyString,
	detailsUrl: TrimmedNonEmptyString,
})
export type GitCallCiJobDetailsRequest = typeof GitCallCiJobDetailsRequest.Type

export const GitCallCiJobDetailsResult = Schema.Struct({
	op: Schema.Literal("git.ciJobDetails"),
	details: GitCallCiJobDetails,
})
export type GitCallCiJobDetailsResult = typeof GitCallCiJobDetailsResult.Type

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
	GitCallRunStackedActionRequest,
	GitCallCollectShipContextRequest,
	GitCallPrDetailsRequest,
	GitCallPrChecksRequest,
	GitCallMergePrRequest,
	GitCallCiJobDetailsRequest,
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
	GitCallRunStackedActionResult,
	GitCallCollectShipContextResult,
	GitCallPrDetailsResult,
	GitCallPrChecksResult,
	GitCallMergePrResult,
	GitCallCiJobDetailsResult,
])
export type GitCallResult = typeof GitCallResult.Type

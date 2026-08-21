import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Schema from "effect/Schema"

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export type NonNegativeInt = typeof NonNegativeInt.Type

export const FileGitStatus = Schema.Struct({
	path: Schema.String,
	status: Schema.String,
	insertions: NonNegativeInt,
	deletions: NonNegativeInt
})
export type FileGitStatus = typeof FileGitStatus.Type

export const ProjectGitOverview = Schema.Struct({
	branch: Schema.NullOr(Schema.String),
	gitStatus: Schema.Array(FileGitStatus)
})
export type ProjectGitOverview = typeof ProjectGitOverview.Type

export const GitPanelFileStatus = Schema.Struct({
	path: Schema.String,
	indexStatus: Schema.NullOr(Schema.String),
	worktreeStatus: Schema.NullOr(Schema.String),
	indexInsertions: NonNegativeInt,
	indexDeletions: NonNegativeInt,
	worktreeInsertions: NonNegativeInt,
	worktreeDeletions: NonNegativeInt
})
export type GitPanelFileStatus = typeof GitPanelFileStatus.Type

export const GitDiffStats = Schema.Struct({
	insertions: NonNegativeInt,
	deletions: NonNegativeInt,
	filesChanged: NonNegativeInt
})
export type GitDiffStats = typeof GitDiffStats.Type

export const CommitResult = Schema.Struct({
	sha: Schema.String,
	shortSha: Schema.String
})
export type CommitResult = typeof CommitResult.Type

export const GitRemoteStatus = Schema.Struct({
	ahead: NonNegativeInt,
	behind: NonNegativeInt,
	remote: Schema.String,
	trackingBranch: Schema.String
})
export type GitRemoteStatus = typeof GitRemoteStatus.Type

export const GitStashEntry = Schema.Struct({
	index: NonNegativeInt,
	message: Schema.String,
	date: Schema.String
})
export type GitStashEntry = typeof GitStashEntry.Type

export const GitLogEntry = Schema.Struct({
	sha: Schema.String,
	shortSha: Schema.String,
	message: Schema.String,
	author: Schema.String,
	date: Schema.String
})
export type GitLogEntry = typeof GitLogEntry.Type

export const FileDiffResult = Schema.Struct({
	oldContent: Schema.NullOr(Schema.String),
	newContent: Schema.String,
	fileName: Schema.String
})
export type FileDiffResult = typeof FileDiffResult.Type

export const WorkingFileDiff = Schema.Struct({
	path: Schema.String,
	status: Schema.String,
	additions: Schema.Int,
	deletions: Schema.Int,
	patch: Schema.String
})
export type WorkingFileDiff = typeof WorkingFileDiff.Type

export const GitBlameLine = Schema.Struct({
	line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	commit: Schema.String,
	author: Schema.String,
	summary: Schema.String
})
export type GitBlameLine = typeof GitBlameLine.Type

export const CloneResult = Schema.Struct({
	path: Schema.String,
	name: Schema.String
})
export type CloneResult = typeof CloneResult.Type

export const WorktreeOrigin = Schema.Literals(["acepe", "external"])
export type WorktreeOrigin = typeof WorktreeOrigin.Type

export const WorktreeInfo = Schema.Struct({
	name: Schema.String,
	branch: Schema.String,
	directory: Schema.String,
	origin: WorktreeOrigin
})
export type WorktreeInfo = typeof WorktreeInfo.Type

export const PreparedWorktreeLaunch = Schema.Struct({
	launchToken: Schema.String,
	sequenceId: Schema.Int,
	worktree: WorktreeInfo
})
export type PreparedWorktreeLaunch = typeof PreparedWorktreeLaunch.Type

export const WorktreeConfig = Schema.Struct({
	setupCommands: Schema.Array(Schema.String)
})
export type WorktreeConfig = typeof WorktreeConfig.Type

export const CommandOutput = Schema.Struct({
	command: Schema.String,
	stdout: Schema.String,
	stderr: Schema.String,
	exitCode: Schema.Int
})
export type CommandOutput = typeof CommandOutput.Type

export const SetupResult = Schema.Struct({
	success: Schema.Boolean,
	outputs: Schema.Array(CommandOutput),
	error: Schema.NullOr(Schema.String)
})
export type SetupResult = typeof SetupResult.Type

export const GitStackedAction = Schema.Literals(["commit", "commit_push", "commit_push_pr"])
export type GitStackedAction = typeof GitStackedAction.Type

export const GitStackedCommitStep = Schema.Struct({
	status: Schema.Literals(["created", "skipped_no_changes"]),
	commitSha: Schema.optionalKey(Schema.String),
	subject: Schema.optionalKey(Schema.String)
})
export type GitStackedCommitStep = typeof GitStackedCommitStep.Type

export const GitStackedPushStep = Schema.Struct({
	status: Schema.Literals(["pushed", "skipped_not_requested"]),
	branch: Schema.optionalKey(Schema.String),
	upstreamBranch: Schema.optionalKey(Schema.String)
})
export type GitStackedPushStep = typeof GitStackedPushStep.Type

export const GitStackedPrStep = Schema.Struct({
	status: Schema.Literals(["created", "opened_existing", "skipped_not_requested"]),
	url: Schema.optionalKey(Schema.String),
	number: Schema.optionalKey(Schema.Int),
	title: Schema.optionalKey(Schema.String),
	baseBranch: Schema.optionalKey(Schema.String),
	headBranch: Schema.optionalKey(Schema.String)
})
export type GitStackedPrStep = typeof GitStackedPrStep.Type

export const GitStackedActionResult = Schema.Struct({
	action: GitStackedAction,
	commit: GitStackedCommitStep,
	push: GitStackedPushStep,
	pr: GitStackedPrStep
})
export type GitStackedActionResult = typeof GitStackedActionResult.Type

export const MergeStrategy = Schema.Literals(["squash", "merge", "rebase"])
export type MergeStrategy = typeof MergeStrategy.Type

export const OpenPrInfo = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	url: Schema.String
})
export type OpenPrInfo = typeof OpenPrInfo.Type

export const PrState = Schema.Literals(["OPEN", "CLOSED", "MERGED"])
export type PrState = typeof PrState.Type

export const PrCommit = Schema.Struct({
	oid: Schema.String,
	messageHeadline: Schema.String,
	additions: Schema.Int,
	deletions: Schema.Int
})
export type PrCommit = typeof PrCommit.Type

export const PrDetails = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	body: Schema.String,
	state: PrState,
	url: Schema.String,
	isDraft: Schema.Boolean,
	additions: Schema.Int,
	deletions: Schema.Int,
	commits: Schema.Array(PrCommit)
})
export type PrDetails = typeof PrDetails.Type

export const PrCheckStatus = Schema.Literals(["QUEUED", "IN_PROGRESS", "COMPLETED", "UNKNOWN"])
export type PrCheckStatus = typeof PrCheckStatus.Type

export const PrCheckConclusion = Schema.Literals([
	"SUCCESS",
	"FAILURE",
	"NEUTRAL",
	"CANCELLED",
	"SKIPPED",
	"TIMED_OUT",
	"ACTION_REQUIRED",
	"STALE",
	"STARTUP_FAILURE",
	"UNKNOWN"
])
export type PrCheckConclusion = typeof PrCheckConclusion.Type

export const PrCheckRun = Schema.Struct({
	name: Schema.String,
	status: PrCheckStatus,
	conclusion: Schema.NullOr(PrCheckConclusion),
	detailsUrl: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.String),
	completedAt: Schema.NullOr(Schema.String),
	workflowName: Schema.NullOr(Schema.String)
})
export type PrCheckRun = typeof PrCheckRun.Type

export const PrChecks = Schema.Struct({
	prNumber: Schema.Int,
	headSha: Schema.String,
	checkRuns: Schema.Array(PrCheckRun)
})
export type PrChecks = typeof PrChecks.Type

export const CiJobStep = Schema.Struct({
	number: Schema.Int,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	log: Schema.String
})
export type CiJobStep = typeof CiJobStep.Type

export const CiJobDetails = Schema.Struct({
	id: Schema.Int,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	steps: Schema.Array(CiJobStep)
})
export type CiJobDetails = typeof CiJobDetails.Type

export const ShipContext = Schema.Struct({
	prompt: Schema.String,
	branch: Schema.String,
	stagedSummary: Schema.String
})
export type ShipContext = typeof ShipContext.Type

export const GitHeadChangedPayload = Schema.Struct({
	projectPath: Schema.String,
	branch: Schema.NullOr(Schema.String)
})
export type GitHeadChangedPayload = typeof GitHeadChangedPayload.Type

export const GitCloneInput = Schema.Struct({
	url: TrimmedNonEmptyString,
	destination: TrimmedNonEmptyString,
	branch: Schema.optionalKey(TrimmedNonEmptyString)
})
export type GitCloneInput = typeof GitCloneInput.Type

export const GitCheckoutInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	branch: TrimmedNonEmptyString,
	create: Schema.optionalKey(Schema.Boolean)
})
export type GitCheckoutInput = typeof GitCheckoutInput.Type

export const GitCreateBranchInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	startPoint: Schema.optionalKey(TrimmedNonEmptyString)
})
export type GitCreateBranchInput = typeof GitCreateBranchInput.Type

export const GitDeleteBranchInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	force: Schema.optionalKey(Schema.Boolean)
})
export type GitDeleteBranchInput = typeof GitDeleteBranchInput.Type

export const GitFilesInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	files: Schema.Array(TrimmedNonEmptyString)
})
export type GitFilesInput = typeof GitFilesInput.Type

export const GitCommitInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	message: Schema.String
})
export type GitCommitInput = typeof GitCommitInput.Type

export const GitLogInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	limit: Schema.optionalKey(NonNegativeInt)
})
export type GitLogInput = typeof GitLogInput.Type

export const GitStashIndexInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	index: NonNegativeInt
})
export type GitStashIndexInput = typeof GitStashIndexInput.Type

export const GitStashSaveInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	message: Schema.optionalKey(Schema.String)
})
export type GitStashSaveInput = typeof GitStashSaveInput.Type

export const FileDiffInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	filePath: TrimmedNonEmptyString
})
export type FileDiffInput = typeof FileDiffInput.Type

export const WorkingFileDiffInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	filePath: TrimmedNonEmptyString,
	staged: Schema.Boolean,
	status: Schema.String,
	additions: Schema.Int,
	deletions: Schema.Int
})
export type WorkingFileDiffInput = typeof WorkingFileDiffInput.Type

export const GitBlameInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	filePath: TrimmedNonEmptyString
})
export type GitBlameInput = typeof GitBlameInput.Type

export const GitShipContextInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	customInstructions: Schema.optionalKey(Schema.String)
})
export type GitShipContextInput = typeof GitShipContextInput.Type

export const GitStackedActionInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	action: GitStackedAction,
	commitMessage: Schema.String,
	prTitle: Schema.optionalKey(Schema.String),
	prBody: Schema.optionalKey(Schema.String)
})
export type GitStackedActionInput = typeof GitStackedActionInput.Type

export const GitWorktreeRemoveInput = Schema.Struct({
	worktreePath: TrimmedNonEmptyString,
	force: Schema.optionalKey(Schema.Boolean)
})
export type GitWorktreeRemoveInput = typeof GitWorktreeRemoveInput.Type

export const GitWorktreeRenameInput = Schema.Struct({
	worktreePath: TrimmedNonEmptyString,
	newName: TrimmedNonEmptyString
})
export type GitWorktreeRenameInput = typeof GitWorktreeRenameInput.Type

export const GitPrepareWorktreeInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	agentId: TrimmedNonEmptyString
})
export type GitPrepareWorktreeInput = typeof GitPrepareWorktreeInput.Type

export const GitDiscardWorktreeLaunchInput = Schema.Struct({
	launchToken: TrimmedNonEmptyString,
	removeWorktree: Schema.optionalKey(Schema.Boolean)
})
export type GitDiscardWorktreeLaunchInput = typeof GitDiscardWorktreeLaunchInput.Type

export const GitSaveWorktreeConfigInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	setupCommands: Schema.Array(Schema.String)
})
export type GitSaveWorktreeConfigInput = typeof GitSaveWorktreeConfigInput.Type

export const GitWorktreeSetupInput = Schema.Struct({
	worktreePath: TrimmedNonEmptyString,
	projectPath: TrimmedNonEmptyString
})
export type GitWorktreeSetupInput = typeof GitWorktreeSetupInput.Type

export const GitPrNumberInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	prNumber: Schema.Int
})
export type GitPrNumberInput = typeof GitPrNumberInput.Type

export const GitMergePrInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	prNumber: Schema.Int,
	strategy: MergeStrategy
})
export type GitMergePrInput = typeof GitMergePrInput.Type

export const GitCiJobInput = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	detailsUrl: TrimmedNonEmptyString
})
export type GitCiJobInput = typeof GitCiJobInput.Type

export const AcepeConfigFile = Schema.Struct({
	worktree: Schema.optionalKey(
		Schema.Struct({
			setupCommands: Schema.Array(Schema.String).pipe(Schema.optionalKey)
		})
	)
})
export type AcepeConfigFile = typeof AcepeConfigFile.Type

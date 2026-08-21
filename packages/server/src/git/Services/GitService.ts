import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type * as Stream from "effect/Stream"
import type { GitServiceError } from "../Errors.ts"
import type {
	CiJobDetails,
	CloneResult,
	CommitResult,
	FileDiffInput,
	FileDiffResult,
	FileGitStatus,
	GitBlameInput,
	GitBlameLine,
	GitCheckoutInput,
	GitCiJobInput,
	GitCloneInput,
	GitCommitInput,
	GitCreateBranchInput,
	GitDeleteBranchInput,
	GitDiffStats,
	GitDiscardWorktreeLaunchInput,
	GitFilesInput,
	GitHeadChangedPayload,
	GitLogEntry,
	GitLogInput,
	GitMergePrInput,
	GitPanelFileStatus,
	GitPrepareWorktreeInput,
	GitPrNumberInput,
	GitRemoteStatus,
	GitSaveWorktreeConfigInput,
	GitShipContextInput,
	GitStackedActionInput,
	GitStackedActionResult,
	GitStashEntry,
	GitStashIndexInput,
	GitStashSaveInput,
	GitWorktreeRemoveInput,
	GitWorktreeRenameInput,
	GitWorktreeSetupInput,
	OpenPrInfo,
	PrChecks,
	PrDetails,
	PreparedWorktreeLaunch,
	ProjectGitOverview,
	SetupResult,
	ShipContext,
	WorkingFileDiff,
	WorkingFileDiffInput,
	WorktreeConfig,
	WorktreeInfo
} from "../Schemas.ts"

export interface GitServiceShape {
	readonly isRepo: (projectPath: string) => Effect.Effect<boolean, GitServiceError>
	readonly init: (projectPath: string) => Effect.Effect<void, GitServiceError>
	readonly clone: (input: GitCloneInput) => Effect.Effect<CloneResult, GitServiceError>
	readonly currentBranch: (projectPath: string) => Effect.Effect<string, GitServiceError>
	readonly listBranches: (
		projectPath: string
	) => Effect.Effect<ReadonlyArray<string>, GitServiceError>
	readonly checkoutBranch: (input: GitCheckoutInput) => Effect.Effect<string, GitServiceError>
	readonly createBranch: (input: GitCreateBranchInput) => Effect.Effect<string, GitServiceError>
	readonly deleteBranch: (input: GitDeleteBranchInput) => Effect.Effect<void, GitServiceError>
	readonly hasUncommittedChanges: (projectPath: string) => Effect.Effect<boolean, GitServiceError>
	readonly panelStatus: (
		projectPath: string
	) => Effect.Effect<ReadonlyArray<GitPanelFileStatus>, GitServiceError>
	readonly projectGitStatus: (
		projectPath: string
	) => Effect.Effect<ReadonlyArray<FileGitStatus>, GitServiceError>
	readonly projectGitStatusSummary: (
		projectPath: string
	) => Effect.Effect<ReadonlyArray<FileGitStatus>, GitServiceError>
	readonly fileGitStatusSummary: (
		projectPath: string,
		filePath: string
	) => Effect.Effect<Option.Option<FileGitStatus>, GitServiceError>
	readonly projectGitOverview: (
		projectPath: string
	) => Effect.Effect<ProjectGitOverview, GitServiceError>
	readonly diffStats: (projectPath: string) => Effect.Effect<GitDiffStats, GitServiceError>
	readonly fileDiff: (input: FileDiffInput) => Effect.Effect<FileDiffResult, GitServiceError>
	readonly workingFileDiff: (
		input: WorkingFileDiffInput
	) => Effect.Effect<WorkingFileDiff, GitServiceError>
	readonly blame: (
		input: GitBlameInput
	) => Effect.Effect<ReadonlyArray<GitBlameLine>, GitServiceError>
	readonly stageFiles: (input: GitFilesInput) => Effect.Effect<void, GitServiceError>
	readonly unstageFiles: (input: GitFilesInput) => Effect.Effect<void, GitServiceError>
	readonly stageAll: (projectPath: string) => Effect.Effect<void, GitServiceError>
	readonly discardChanges: (input: GitFilesInput) => Effect.Effect<void, GitServiceError>
	readonly commit: (input: GitCommitInput) => Effect.Effect<CommitResult, GitServiceError>
	readonly push: (projectPath: string) => Effect.Effect<void, GitServiceError>
	readonly pull: (projectPath: string) => Effect.Effect<void, GitServiceError>
	readonly fetch: (projectPath: string) => Effect.Effect<void, GitServiceError>
	readonly remoteStatus: (projectPath: string) => Effect.Effect<GitRemoteStatus, GitServiceError>
	readonly stashList: (
		projectPath: string
	) => Effect.Effect<ReadonlyArray<GitStashEntry>, GitServiceError>
	readonly stashPop: (input: GitStashIndexInput) => Effect.Effect<void, GitServiceError>
	readonly stashDrop: (input: GitStashIndexInput) => Effect.Effect<void, GitServiceError>
	readonly stashSave: (input: GitStashSaveInput) => Effect.Effect<void, GitServiceError>
	readonly log: (input: GitLogInput) => Effect.Effect<ReadonlyArray<GitLogEntry>, GitServiceError>
	readonly collectShipContext: (
		input: GitShipContextInput
	) => Effect.Effect<Option.Option<ShipContext>, GitServiceError>
	readonly runStackedAction: (
		input: GitStackedActionInput
	) => Effect.Effect<GitStackedActionResult, GitServiceError>
	readonly worktreeCreate: (projectPath: string) => Effect.Effect<WorktreeInfo, GitServiceError>
	readonly worktreeRemove: (input: GitWorktreeRemoveInput) => Effect.Effect<void, GitServiceError>
	readonly worktreeList: (
		projectPath: string
	) => Effect.Effect<ReadonlyArray<WorktreeInfo>, GitServiceError>
	readonly worktreeRename: (
		input: GitWorktreeRenameInput
	) => Effect.Effect<WorktreeInfo, GitServiceError>
	readonly worktreeReset: (worktreePath: string) => Effect.Effect<void, GitServiceError>
	readonly worktreeDiskSize: (path: string) => Effect.Effect<number, GitServiceError>
	readonly prepareWorktreeSessionLaunch: (
		input: GitPrepareWorktreeInput
	) => Effect.Effect<PreparedWorktreeLaunch, GitServiceError>
	readonly discardPreparedWorktreeSessionLaunch: (
		input: GitDiscardWorktreeLaunchInput
	) => Effect.Effect<void, GitServiceError>
	readonly loadWorktreeConfig: (
		projectPath: string
	) => Effect.Effect<Option.Option<WorktreeConfig>, GitServiceError>
	readonly saveWorktreeConfig: (
		input: GitSaveWorktreeConfigInput
	) => Effect.Effect<void, GitServiceError>
	readonly runWorktreeSetup: (input: GitWorktreeSetupInput) => Effect.Effect<SetupResult, GitServiceError>
	readonly prDetails: (input: GitPrNumberInput) => Effect.Effect<PrDetails, GitServiceError>
	readonly prChecks: (input: GitPrNumberInput) => Effect.Effect<PrChecks, GitServiceError>
	readonly mergePr: (input: GitMergePrInput) => Effect.Effect<void, GitServiceError>
	readonly getOpenPrForBranch: (
		projectPath: string
	) => Effect.Effect<Option.Option<OpenPrInfo>, GitServiceError>
	readonly ciJobDetails: (input: GitCiJobInput) => Effect.Effect<CiJobDetails, GitServiceError>
	readonly watchHead: (
		projectPath: string
	) => Stream.Stream<GitHeadChangedPayload, GitServiceError>
}

export class GitService extends Context.Service<GitService, GitServiceShape>()(
	"@acepe/server/git/Services/GitService"
) {}

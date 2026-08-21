import * as Schema from "effect/Schema"

export class GitCommandError extends Schema.TaggedError<GitCommandError>()("GitCommandError", {
	bin: Schema.String,
	args: Schema.Array(Schema.String),
	cwd: Schema.String,
	exitCode: Schema.Int,
	stderr: Schema.String
}) {
	override get message(): string {
		if (this.stderr !== "") {
			return this.stderr
		}
		return `${this.bin} ${this.args[0] ?? ""} failed with exit code ${String(this.exitCode)}`
	}
}

export class GitPathNotFoundError extends Schema.TaggedError<GitPathNotFoundError>()(
	"GitPathNotFoundError",
	{
		path: Schema.String
	}
) {
	override get message(): string {
		return `Path does not exist: ${this.path}`
	}
}

export class GitNotARepositoryError extends Schema.TaggedError<GitNotARepositoryError>()(
	"GitNotARepositoryError",
	{
		path: Schema.String
	}
) {
	override get message(): string {
		return `Path is not a git repository: ${this.path}`
	}
}

export class GitAlreadyRepositoryError extends Schema.TaggedError<GitAlreadyRepositoryError>()(
	"GitAlreadyRepositoryError",
	{
		path: Schema.String
	}
) {
	override get message(): string {
		return `Path is already a git repository: ${this.path}`
	}
}

export class GitInvalidCloneUrlError extends Schema.TaggedError<GitInvalidCloneUrlError>()(
	"GitInvalidCloneUrlError",
	{
		url: Schema.String
	}
) {
	override get message(): string {
		return "Invalid repository URL format. URL must start with https://, http://, or git@"
	}
}

export class GitCloneDestinationExistsError extends Schema.TaggedError<GitCloneDestinationExistsError>()(
	"GitCloneDestinationExistsError",
	{
		destination: Schema.String
	}
) {
	override get message(): string {
		return `Destination folder already exists: ${this.destination}`
	}
}

export class GitEmptyCommitMessageError extends Schema.TaggedError<GitEmptyCommitMessageError>()(
	"GitEmptyCommitMessageError",
	{}
) {
	override get message(): string {
		return "Commit message cannot be empty"
	}
}

export class GitCommitMessageRequiredError extends Schema.TaggedError<GitCommitMessageRequiredError>()(
	"GitCommitMessageRequiredError",
	{}
) {
	override get message(): string {
		return "Commit message required when there are staged changes"
	}
}

export class GitBranchNotMergedError extends Schema.TaggedError<GitBranchNotMergedError>()(
	"GitBranchNotMergedError",
	{
		name: Schema.String
	}
) {
	override get message(): string {
		return `Branch '${this.name}' is not fully merged. Use force=true to delete anyway.`
	}
}

export class GitInvalidStackedActionError extends Schema.TaggedError<GitInvalidStackedActionError>()(
	"GitInvalidStackedActionError",
	{
		action: Schema.String
	}
) {
	override get message(): string {
		return "Invalid action: use commit, commit_push, or commit_push_pr"
	}
}

export class GitInvalidMergeStrategyError extends Schema.TaggedError<GitInvalidMergeStrategyError>()(
	"GitInvalidMergeStrategyError",
	{
		strategy: Schema.String
	}
) {
	override get message(): string {
		return `Invalid merge strategy: ${this.strategy}`
	}
}

export class GitConfigError extends Schema.TaggedError<GitConfigError>()("GitConfigError", {
	path: Schema.String,
	reason: Schema.String
}) {
	override get message(): string {
		return `Failed to read worktree config at ${this.path}: ${this.reason}`
	}
}

export type GitServiceError =
	| GitAlreadyRepositoryError
	| GitBranchNotMergedError
	| GitCloneDestinationExistsError
	| GitCommandError
	| GitCommitMessageRequiredError
	| GitConfigError
	| GitEmptyCommitMessageError
	| GitInvalidCloneUrlError
	| GitInvalidMergeStrategyError
	| GitInvalidStackedActionError
	| GitNotARepositoryError
	| GitPathNotFoundError

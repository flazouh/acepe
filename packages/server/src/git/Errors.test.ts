import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	GitAlreadyRepositoryError,
	GitBranchNotMergedError,
	GitCloneDestinationExistsError,
	GitCommandError,
	GitCommitMessageRequiredError,
	GitConfigError,
	GitEmptyCommitMessageError,
	GitInvalidCloneUrlError,
	GitInvalidMergeStrategyError,
	GitInvalidStackedActionError,
	GitNotARepositoryError,
	GitPathNotFoundError
} from "./Errors.ts"

Vitest.describe("GitCommandError", () => {
	Vitest.it.effect("uses stderr when git prints a reason", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new GitCommandError({
					bin: "git",
					args: ["commit"],
					cwd: "/tmp/repo",
					exitCode: 1,
					stderr: "nothing to commit"
				})
			)
			Vitest.assert.strictEqual(error._tag, "GitCommandError")
			Vitest.assert.strictEqual(error.message, "nothing to commit")
		})
	)

	Vitest.it.effect("falls back to the exit code when stderr is empty", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new GitCommandError({
					bin: "git",
					args: ["push"],
					cwd: "/tmp/repo",
					exitCode: 128,
					stderr: ""
				})
			)
			Vitest.assert.strictEqual(error.message, "git push failed with exit code 128")
		})
	)
})

Vitest.describe("Git path errors", () => {
	Vitest.it.effect("names a missing path", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitPathNotFoundError({ path: "/missing" }))
			Vitest.assert.strictEqual(error.message, "Path does not exist: /missing")
		})
	)

	Vitest.it.effect("names a path that is not a repository", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitNotARepositoryError({ path: "/tmp" }))
			Vitest.assert.strictEqual(error.message, "Path is not a git repository: /tmp")
		})
	)

	Vitest.it.effect("names a path that is already a repository", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitAlreadyRepositoryError({ path: "/tmp/repo" }))
			Vitest.assert.strictEqual(error.message, "Path is already a git repository: /tmp/repo")
		})
	)
})

Vitest.describe("Git input errors", () => {
	Vitest.it.effect("rejects a clone URL that is not git or http", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitInvalidCloneUrlError({ url: "ftp://x" }))
			Vitest.assert.strictEqual(
				error.message,
				"Invalid repository URL format. URL must start with https://, http://, or git@"
			)
		})
	)

	Vitest.it.effect("rejects a clone destination that already exists", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new GitCloneDestinationExistsError({ destination: "/tmp/out" })
			)
			Vitest.assert.strictEqual(error.message, "Destination folder already exists: /tmp/out")
		})
	)

	Vitest.it.effect("rejects an empty commit message", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitEmptyCommitMessageError({}))
			Vitest.assert.strictEqual(error.message, "Commit message cannot be empty")
		})
	)

	Vitest.it.effect("requires a commit message when changes are staged", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitCommitMessageRequiredError({}))
			Vitest.assert.strictEqual(
				error.message,
				"Commit message required when there are staged changes"
			)
		})
	)

	Vitest.it.effect("refuses to delete an unmerged branch without force", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitBranchNotMergedError({ name: "topic" }))
			Vitest.assert.strictEqual(
				error.message,
				"Branch 'topic' is not fully merged. Use force=true to delete anyway."
			)
		})
	)

	Vitest.it.effect("rejects an unknown stacked action", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitInvalidStackedActionError({ action: "rebase" }))
			Vitest.assert.strictEqual(
				error.message,
				"Invalid action: use commit, commit_push, or commit_push_pr"
			)
		})
	)

	Vitest.it.effect("rejects an unknown merge strategy", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new GitInvalidMergeStrategyError({ strategy: "fast" }))
			Vitest.assert.strictEqual(error.message, "Invalid merge strategy: fast")
		})
	)

	Vitest.it.effect("reports a worktree config read failure", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new GitConfigError({ path: "/tmp/.acepe.json", reason: "invalid JSON" })
			)
			Vitest.assert.strictEqual(
				error.message,
				"Failed to read worktree config at /tmp/.acepe.json: invalid JSON"
			)
		})
	)
})

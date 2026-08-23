import {
	FileGitStatus,
	GitBlameLine,
	GitFileDiff,
	type OrchestrationCommand,
	applyHunks,
	parseUnifiedHunks,
	revertHunksInContent
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import { ProjectionGit } from "../persistence/Services/ProjectionGit.ts"
import type { GitServiceError } from "./Errors.ts"
import { GitService } from "./Services/GitService.ts"

const decodeStatus = Schema.decodeUnknownEffect(Schema.Array(FileGitStatus))
const decodeDiff = Schema.decodeUnknownEffect(GitFileDiff)
const decodeBlame = Schema.decodeUnknownEffect(Schema.Array(GitBlameLine))

const asGitInvariant = (commandType: string) => (error: { readonly message: string }) =>
	new OrchestrationCommandInvariantError({
		commandType,
		detail: error.message
	})

const runGit = <A>(
	commandType: string,
	program: Effect.Effect<A, GitServiceError | Schema.SchemaError>
) => program.pipe(Effect.mapError(asGitInvariant(commandType)))

const workingStatus = (status: string): "added" | "modified" => {
	if (status === "A" || status === "?") {
		return "added"
	}
	return "modified"
}

const loadPatch = Effect.fn("loadGitPatch")(function*(
	commandType: string,
	workspaceRoot: string,
	filePath: string
) {
	const git = yield* GitService
	const summary = yield* runGit(commandType, git.fileGitStatusSummary(workspaceRoot, filePath))
	const status = Option.match(summary, {
		onNone: () => "modified" as const,
		onSome: (row) => workingStatus(row.status)
	})
	const working = yield* runGit(
		commandType,
		git.workingFileDiff({
			projectPath: workspaceRoot,
			filePath,
			staged: false,
			status,
			additions: 0,
			deletions: 0
		})
	)
	return working.patch
})

const fillStatusRefresh = Effect.fn("fillGitStatusRefresh")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "git.status.refresh" }>
) {
	const git = yield* GitService
	const status = yield* git.projectGitStatus(command.workspaceRoot).pipe(
		Effect.flatMap(decodeStatus),
		Effect.mapError(asGitInvariant(command.type)),
		Effect.orElseSucceed(() => null)
	)
	return {
		type: command.type,
		commandId: command.commandId,
		projectId: command.projectId,
		workspaceRoot: command.workspaceRoot,
		status
	} satisfies OrchestrationCommand
})

const fillDiffLoad = Effect.fn("fillGitDiffLoad")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "git.diff.load" }>
) {
	const git = yield* GitService
	const diff = yield* runGit(
		command.type,
		git
			.fileDiff({
				projectPath: command.workspaceRoot,
				filePath: command.filePath
			})
			.pipe(Effect.flatMap(decodeDiff))
	)
	const patch = yield* loadPatch(command.type, command.workspaceRoot, command.filePath)
	return {
		type: command.type,
		commandId: command.commandId,
		projectId: command.projectId,
		workspaceRoot: command.workspaceRoot,
		filePath: command.filePath,
		diff,
		patch
	} satisfies OrchestrationCommand
})

const fillBlameLoad = Effect.fn("fillGitBlameLoad")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "git.blame.load" }>
) {
	const git = yield* GitService
	const blame = yield* runGit(
		command.type,
		git
			.blame({
				projectPath: command.workspaceRoot,
				filePath: command.filePath
			})
			.pipe(Effect.flatMap(decodeBlame))
	)
	return {
		type: command.type,
		commandId: command.commandId,
		projectId: command.projectId,
		workspaceRoot: command.workspaceRoot,
		filePath: command.filePath,
		blame
	} satisfies OrchestrationCommand
})

const writeReverted = Effect.fn("writeRevertedGitFile")(function*(
	commandType: string,
	workspaceRoot: string,
	filePath: string,
	next: string
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const fullPath = path.join(workspaceRoot, filePath)
	yield* fs.writeFileString(fullPath, next).pipe(Effect.mapError(asGitInvariant(commandType)))
})

const requireHunk = (
	commandType: string,
	filePath: string,
	hunkIndex: number,
	patch: string
) => {
	const hunks = parseUnifiedHunks(patch)
	if (hunkIndex >= hunks.length) {
		return Effect.fail(
			new OrchestrationCommandInvariantError({
				commandType,
				detail: `Hunk ${String(hunkIndex)} does not exist on '${filePath}'.`
			})
		)
	}
	return Effect.void
}

const fillHunkReject = Effect.fn("fillGitHunkReject")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "git.hunk.reject" }>
) {
	const git = yield* GitService
	const projection = yield* ProjectionGit
	const stored = yield* projection.get(command.projectId).pipe(
		Effect.mapError(asGitInvariant(command.type))
	)
	const file = Option.flatMap(stored, (review) =>
		Arr.findFirst(review.files, (row) => row.path === command.filePath)
	)
	if (Option.isSome(file) && file.value.patch !== "" && file.value.diff !== null) {
		yield* requireHunk(command.type, command.filePath, command.hunkIndex, file.value.patch)
		const originalNew = applyHunks(file.value.diff.oldContent ?? "", file.value.patch)
		const rejected = Arr.append(
			Arr.map(
				Arr.filter(file.value.hunkDecisions, (decision) => decision.action === "rejected"),
				(decision) => decision.hunkIndex
			),
			command.hunkIndex
		)
		const next = revertHunksInContent(originalNew, file.value.patch, rejected)
		yield* writeReverted(command.type, command.workspaceRoot, command.filePath, next)
		return {
			type: command.type,
			commandId: command.commandId,
			projectId: command.projectId,
			workspaceRoot: command.workspaceRoot,
			filePath: command.filePath,
			hunkIndex: command.hunkIndex,
			newContent: next
		} satisfies OrchestrationCommand
	}
	const diff = yield* runGit(
		command.type,
		git
			.fileDiff({
				projectPath: command.workspaceRoot,
				filePath: command.filePath
			})
			.pipe(Effect.flatMap(decodeDiff))
	)
	const patch = yield* loadPatch(command.type, command.workspaceRoot, command.filePath)
	yield* requireHunk(command.type, command.filePath, command.hunkIndex, patch)
	const next = revertHunksInContent(diff.newContent, patch, [command.hunkIndex])
	yield* writeReverted(command.type, command.workspaceRoot, command.filePath, next)
	return {
		type: command.type,
		commandId: command.commandId,
		projectId: command.projectId,
		workspaceRoot: command.workspaceRoot,
		filePath: command.filePath,
		hunkIndex: command.hunkIndex,
		newContent: next
	} satisfies OrchestrationCommand
})

export const fillGitCommand = Effect.fn("fillGitCommand")(function*(
	command: OrchestrationCommand
) {
	switch (command.type) {
		case "git.status.refresh":
			return yield* fillStatusRefresh(command)
		case "git.diff.load":
			return yield* fillDiffLoad(command)
		case "git.blame.load":
			return yield* fillBlameLoad(command)
		case "git.hunk.accept":
			return command
		case "git.hunk.reject":
			return yield* fillHunkReject(command)
		default:
			return command
	}
})

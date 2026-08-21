import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Order from "effect/Order"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { type GitignoreRule, isGitInternalPath, isIgnoredPath, toPosixPath } from "./gitignore.ts"
import { indexedFileFromRelativePath } from "./scanner.ts"
import {
	type FileGitStatus,
	type FileIndexUpdate,
	type IndexedFile,
	type ProjectIndex
} from "./Schemas.ts"

const decodeProjectPath = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const gitStatusFirst: Order.Order<IndexedFile> = Order.mapInput(
	Order.Number,
	(file: IndexedFile) => (file.gitStatus === null ? 1 : 0)
)

const indexedFileOrder: Order.Order<IndexedFile> = Order.combine(
	gitStatusFirst,
	Order.mapInput(Str.Order, (file: IndexedFile) => file.path)
)

export const sortIndexedFiles = (files: ReadonlyArray<IndexedFile>): ReadonlyArray<IndexedFile> =>
	Arr.sort(files, indexedFileOrder)

export const emptyGitStatus = (): ReadonlyArray<FileGitStatus> => Arr.empty()

export const buildProjectIndex = Effect.fn("buildProjectIndex")(function*(
	projectPath: string,
	files: ReadonlyArray<IndexedFile>,
	gitStatus: ReadonlyArray<FileGitStatus>
) {
	const sorted = sortIndexedFiles(files)
	const decodedPath = yield* decodeProjectPath(projectPath)
	return {
		projectPath: decodedPath,
		files: sorted,
		gitStatus,
		totalFiles: sorted.length,
		totalLines: Arr.reduce(sorted, 0, (total, file) => total + file.lineCount)
	} satisfies ProjectIndex
})

const removePath = (
	files: ReadonlyArray<IndexedFile>,
	relativePath: string
): ReadonlyArray<IndexedFile> => Arr.filter(files, (file) => file.path !== relativePath)

const applyOneUpdate = (ignoreRules: ReadonlyArray<GitignoreRule>) =>
	(files: ReadonlyArray<IndexedFile>, update: FileIndexUpdate) => {
		const relativePath = toPosixPath(update.relativePath)
		if (
			update.type === "remove" ||
			isGitInternalPath(relativePath) === true ||
			isIgnoredPath(ignoreRules, relativePath) === true
		) {
			return Effect.succeed(removePath(files, relativePath))
		}
		return indexedFileFromRelativePath(relativePath).pipe(
			Effect.map((next) => Arr.append(removePath(files, relativePath), next))
		)
	}

export const applyFileIndexUpdates = Effect.fn("applyFileIndexUpdates")(function*(
	index: ProjectIndex,
	updates: ReadonlyArray<FileIndexUpdate>,
	ignoreRules: ReadonlyArray<GitignoreRule>
) {
	const files = yield* Effect.reduce(updates, () => index.files, applyOneUpdate(ignoreRules))
	return yield* buildProjectIndex(index.projectPath, files, index.gitStatus)
})

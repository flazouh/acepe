import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Schema from "effect/Schema"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const FileGitStatus = Schema.Struct({
	path: TrimmedNonEmptyString,
	status: TrimmedNonEmptyString,
	insertions: NonNegativeInt,
	deletions: NonNegativeInt
})
export type FileGitStatus = typeof FileGitStatus.Type

export const IndexedFile = Schema.Struct({
	path: TrimmedNonEmptyString,
	extension: Schema.String,
	lineCount: NonNegativeInt,
	gitStatus: Schema.NullOr(FileGitStatus)
})
export type IndexedFile = typeof IndexedFile.Type

export const ProjectIndex = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	files: Schema.Array(IndexedFile),
	gitStatus: Schema.Array(FileGitStatus),
	totalFiles: NonNegativeInt,
	totalLines: NonNegativeInt
})
export type ProjectIndex = typeof ProjectIndex.Type

export const FileIndexUpsert = Schema.Struct({
	type: Schema.Literal("upsert"),
	relativePath: TrimmedNonEmptyString
})
export type FileIndexUpsert = typeof FileIndexUpsert.Type

export const FileIndexRemove = Schema.Struct({
	type: Schema.Literal("remove"),
	relativePath: TrimmedNonEmptyString
})
export type FileIndexRemove = typeof FileIndexRemove.Type

export const FileIndexUpdate = Schema.Union([FileIndexUpsert, FileIndexRemove])
export type FileIndexUpdate = typeof FileIndexUpdate.Type

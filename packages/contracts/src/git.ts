import * as Schema from "effect/Schema"

import { Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { FileGitStatus } from "./fileIndex.ts"
import { ProjectId } from "./ids.ts"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const GitHunkIndex = NonNegativeInt
export type GitHunkIndex = typeof GitHunkIndex.Type

export const GitFileDiff = Schema.Struct({
	oldContent: Schema.NullOr(Schema.String),
	newContent: Schema.String,
	fileName: TrimmedNonEmptyString,
})
export type GitFileDiff = typeof GitFileDiff.Type

export const GitBlameLine = Schema.Struct({
	line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	commit: Schema.String,
	author: Schema.String,
	summary: Schema.String,
})
export type GitBlameLine = typeof GitBlameLine.Type

export const GitHunkAction = Schema.Literals(["accepted", "rejected"])
export type GitHunkAction = typeof GitHunkAction.Type

export const GitHunkDecision = Schema.Struct({
	hunkIndex: GitHunkIndex,
	action: GitHunkAction,
})
export type GitHunkDecision = typeof GitHunkDecision.Type

export const GitFileReview = Schema.Struct({
	path: TrimmedNonEmptyString,
	diff: Schema.NullOr(GitFileDiff),
	patch: Schema.String,
	blame: Schema.Array(GitBlameLine),
	hunkDecisions: Schema.Array(GitHunkDecision),
})
export type GitFileReview = typeof GitFileReview.Type

export const ProjectedGitReview = Schema.Struct({
	sequence: Sequence,
	projectId: ProjectId,
	status: FileGitStatus.pipe(Schema.Array, Schema.NullOr),
	files: Schema.Array(GitFileReview),
})
export type ProjectedGitReview = typeof ProjectedGitReview.Type

export const emptyGitFileDiff: GitFileDiff = {
	oldContent: null,
	newContent: "",
	fileName: "file",
}

export const emptyGitBlame: ReadonlyArray<GitBlameLine> = []

export const emptyGitFileReview = (path: TrimmedNonEmptyString): GitFileReview => ({
	path,
	diff: null,
	patch: "",
	blame: emptyGitBlame,
	hunkDecisions: [],
})

export const emptyProjectedGitReview = (
	projectId: ProjectId,
	sequence: Sequence,
): ProjectedGitReview => ({
	sequence,
	projectId,
	status: null,
	files: [],
})

import {
	CheckpointFileCount,
	CheckpointId,
	CheckpointNumber,
	SessionId,
	ToolCallId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { PlatformError } from "effect/PlatformError"
import * as Schema from "effect/Schema"
import type { SqlError } from "effect/unstable/sql/SqlError"
import type { OrchestrationDispatchError } from "../../orchestration/Services/OrchestrationEngine.ts"

export class CheckpointEmptyError extends Schema.TaggedError<CheckpointEmptyError>()(
	"CheckpointEmptyError",
	{
		sessionId: SessionId
	}
) {
	override get message(): string {
		return `No files could be read for a checkpoint in session '${this.sessionId}'.`
	}
}

export class CheckpointNotFoundError extends Schema.TaggedError<CheckpointNotFoundError>()(
	"CheckpointNotFoundError",
	{
		checkpointId: CheckpointId
	}
) {
	override get message(): string {
		return `Checkpoint not found: ${this.checkpointId}`
	}
}

export class CheckpointPathError extends Schema.TaggedError<CheckpointPathError>()("CheckpointPathError", {
	path: Schema.String,
	reason: Schema.String
}) {
	override get message(): string {
		return this.reason
	}
}

export class CheckpointSessionMismatchError extends Schema.TaggedError<CheckpointSessionMismatchError>()(
	"CheckpointSessionMismatchError",
	{
		checkpointId: CheckpointId,
		sessionId: SessionId
	}
) {
	override get message(): string {
		return "Access denied: checkpoint belongs to a different session"
	}
}

export class CheckpointConflictError extends Schema.TaggedError<CheckpointConflictError>()(
	"CheckpointConflictError",
	{
		sessionId: SessionId
	}
) {
	override get message(): string {
		return `Failed to create a checkpoint for session '${this.sessionId}' after concurrent number conflicts.`
	}
}

export class CheckpointRevertFailedError extends Schema.TaggedError<CheckpointRevertFailedError>()(
	"CheckpointRevertFailedError",
	{
		checkpointId: CheckpointId,
		failedFiles: Schema.Array(
			Schema.Struct({
				filePath: Schema.String,
				error: Schema.String
			})
		)
	}
) {
	override get message(): string {
		return `Revert aborted for checkpoint '${this.checkpointId}'.`
	}
}

export class CheckpointFileMissingError extends Schema.TaggedError<CheckpointFileMissingError>()(
	"CheckpointFileMissingError",
	{
		checkpointId: CheckpointId,
		filePath: Schema.String
	}
) {
	override get message(): string {
		return `File '${this.filePath}' not found in checkpoint '${this.checkpointId}'`
	}
}

export class CheckpointTimestampError extends Schema.TaggedError<CheckpointTimestampError>()(
	"CheckpointTimestampError",
	{
		createdAt: Schema.Number
	}
) {
	override get message(): string {
		return `Checkpoint created_at '${this.createdAt}' is not a valid epoch millisecond timestamp.`
	}
}

export const FileSnapshot = Schema.Struct({
	id: TrimmedNonEmptyString,
	checkpointId: CheckpointId,
	filePath: TrimmedNonEmptyString,
	contentHash: TrimmedNonEmptyString,
	fileSize: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	linesAdded: Schema.NullOr(Schema.Int),
	linesRemoved: Schema.NullOr(Schema.Int)
})
export type FileSnapshot = typeof FileSnapshot.Type

export const CheckpointRecord = Schema.Struct({
	id: CheckpointId,
	sessionId: SessionId,
	checkpointNumber: CheckpointNumber,
	name: Schema.NullOr(TrimmedNonEmptyString),
	createdAt: Schema.Int,
	toolCallId: Schema.NullOr(ToolCallId),
	isAuto: Schema.Boolean,
	fileCount: CheckpointFileCount,
	totalLinesAdded: Schema.NullOr(Schema.Int),
	totalLinesRemoved: Schema.NullOr(Schema.Int)
})
export type CheckpointRecord = typeof CheckpointRecord.Type

export const FileDiffContent = Schema.Struct({
	oldContent: Schema.NullOr(Schema.String),
	newContent: Schema.String
})
export type FileDiffContent = typeof FileDiffContent.Type

export const RevertError = Schema.Struct({
	filePath: Schema.String,
	error: Schema.String
})
export type RevertError = typeof RevertError.Type

export const RevertResult = Schema.Struct({
	success: Schema.Boolean,
	revertedFiles: Schema.Array(Schema.String),
	failedFiles: Schema.Array(RevertError)
})
export type RevertResult = typeof RevertResult.Type

export const CreateCheckpointInput = Schema.Struct({
	sessionId: SessionId,
	projectPath: TrimmedNonEmptyString,
	worktreePath: Schema.NullOr(TrimmedNonEmptyString),
	modifiedFiles: Schema.Array(Schema.String),
	toolCallId: Schema.NullOr(ToolCallId),
	name: Schema.NullOr(TrimmedNonEmptyString),
	isAuto: Schema.Boolean
})
export type CreateCheckpointInput = typeof CreateCheckpointInput.Type

export const RevertCheckpointInput = Schema.Struct({
	sessionId: SessionId,
	checkpointId: CheckpointId,
	projectPath: TrimmedNonEmptyString,
	worktreePath: Schema.NullOr(TrimmedNonEmptyString)
})
export type RevertCheckpointInput = typeof RevertCheckpointInput.Type

export const RevertFileInput = Schema.Struct({
	sessionId: SessionId,
	checkpointId: CheckpointId,
	filePath: TrimmedNonEmptyString,
	projectPath: TrimmedNonEmptyString,
	worktreePath: Schema.NullOr(TrimmedNonEmptyString)
})
export type RevertFileInput = typeof RevertFileInput.Type

export type CheckpointServiceError =
	| CheckpointEmptyError
	| CheckpointNotFoundError
	| CheckpointPathError
	| CheckpointSessionMismatchError
	| CheckpointConflictError
	| CheckpointRevertFailedError
	| CheckpointFileMissingError
	| CheckpointTimestampError
	| OrchestrationDispatchError
	| PlatformError
	| Schema.SchemaError
	| SqlError

export interface CheckpointServiceShape {
	readonly create: (
		input: CreateCheckpointInput
	) => Effect.Effect<CheckpointRecord, CheckpointServiceError>
	readonly revert: (
		input: RevertCheckpointInput
	) => Effect.Effect<RevertResult, CheckpointServiceError>
	readonly revertFile: (input: RevertFileInput) => Effect.Effect<void, CheckpointServiceError>
	readonly list: (
		sessionId: SessionId
	) => Effect.Effect<ReadonlyArray<CheckpointRecord>, SqlError | Schema.SchemaError>
	readonly get: (
		checkpointId: CheckpointId
	) => Effect.Effect<
		CheckpointRecord,
		CheckpointNotFoundError | SqlError | Schema.SchemaError
	>
	readonly getFileContent: (
		sessionId: SessionId,
		checkpointId: CheckpointId,
		filePath: string
	) => Effect.Effect<string, CheckpointServiceError>
	readonly getFileSnapshots: (
		sessionId: SessionId,
		checkpointId: CheckpointId
	) => Effect.Effect<ReadonlyArray<FileSnapshot>, CheckpointServiceError>
	readonly getFileDiffContent: (
		sessionId: SessionId,
		checkpointId: CheckpointId,
		filePath: string
	) => Effect.Effect<FileDiffContent, CheckpointServiceError>
}

export class CheckpointService extends Context.Service<
	CheckpointService,
	CheckpointServiceShape
>()("@acepe/server/checkpoint/Services/CheckpointService") {}

export const MAX_CHECKPOINT_FILE_SIZE = 10 * 1024 * 1024
export const MAX_CHECKPOINT_RETRIES = 3
export const PRE_REVERT_SAFETY_TOOL_CALL_ID = ToolCallId.make("pre-revert-safety")

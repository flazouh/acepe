import {
	CheckpointCreateCommand,
	CheckpointId,
	CheckpointReportReadinessCommand,
	CheckpointRevertCommand,
	CommandId,
	type SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Crypto from "effect/Crypto"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { SqlError } from "effect/unstable/sql/SqlError"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
import { sha256Hex, utf8Bytes } from "../contentHash.ts"
import { computeDiffStats } from "../diffStats.ts"
import { toRelativeModifiedPath, validateRelativePath } from "../paths.ts"
import {
	CheckpointConflictError,
	CheckpointEmptyError,
	CheckpointFileMissingError,
	type CheckpointRecord,
	CheckpointService,
	CheckpointSessionMismatchError,
	CreateCheckpointInput,
	MAX_CHECKPOINT_FILE_SIZE,
	MAX_CHECKPOINT_RETRIES,
	PRE_REVERT_SAFETY_TOOL_CALL_ID,
	type RevertCheckpointInput,
	type RevertError,
	type RevertFileInput,
	type RevertResult
} from "../Services/CheckpointService.ts"
import {
	type FileSnapshotInsert,
	getPreviousFileContent,
	getStoredCheckpoint,
	getStoredFileContent,
	getStoredFileSnapshots,
	insertCheckpoint,
	listStoredCheckpoints,
	nextCheckpointNumber
} from "../snapshotStore.ts"

const decodeCreateInput = Schema.decodeUnknownEffect(CreateCheckpointInput)
const decodeSafetyName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

type ReadableFile = {
	readonly relativePath: string
	readonly content: string
	readonly contentHash: string
	readonly fileSize: number
}

const isUniqueConstraintError = (error: SqlError): boolean => {
	const text = error.message.toLowerCase()
	return text.includes("unique") || text.includes("duplicate") || text.includes("already exists")
}

const skipNone = <A>(): Option.Option<A> => Option.none()

export const makeCheckpointService = Effect.fn("CheckpointService.make")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const crypto = yield* Crypto.Crypto
	const sql = yield* SqlClient.SqlClient
	const engine = yield* OrchestrationEngine
	const requireOwned = Effect.fn("CheckpointService.requireOwned")(function*(
		sessionId: SessionId,
		checkpointId: CheckpointId
	) {
		const checkpoint = yield* getStoredCheckpoint(sql, checkpointId)
		if (checkpoint.sessionId !== sessionId) {
			return yield* new CheckpointSessionMismatchError({ checkpointId, sessionId })
		}
		return checkpoint
	})

	const dispatchCreated = Effect.fn("CheckpointService.dispatchCreated")(function*(
		record: CheckpointRecord
	) {
		yield* engine.dispatch(
			CheckpointCreateCommand.make({
				type: "checkpoint.create",
				commandId: CommandId.make(yield* crypto.randomUUIDv4),
				sessionId: record.sessionId,
				checkpointId: record.id,
				checkpointNumber: record.checkpointNumber,
				name: record.name,
				isAuto: record.isAuto,
				toolCallId: record.toolCallId,
				fileCount: record.fileCount
			})
		)
	})

	const dispatchReady = Effect.fn("CheckpointService.dispatchReady")(function*(
		record: CheckpointRecord
	) {
		yield* engine.dispatch(
			CheckpointReportReadinessCommand.make({
				type: "checkpoint.report-readiness",
				commandId: CommandId.make(yield* crypto.randomUUIDv4),
				sessionId: record.sessionId,
				checkpointId: record.id,
				status: "ready"
			})
		)
	})

	const dispatchReverted = Effect.fn("CheckpointService.dispatchReverted")(function*(
		record: CheckpointRecord
	) {
		yield* engine.dispatch(
			CheckpointRevertCommand.make({
				type: "checkpoint.revert",
				commandId: CommandId.make(yield* crypto.randomUUIDv4),
				sessionId: record.sessionId,
				checkpointId: record.id
			})
		)
	})

	const readOneFile = Effect.fn("CheckpointService.readOneFile")(function*(
		projectPath: string,
		relativePath: string
	) {
		const fullPath = yield* validateRelativePath(fs, path, projectPath, relativePath)
		const exists = yield* fs.exists(fullPath)
		if (exists === false) {
			return skipNone<ReadableFile>()
		}
		const info = yield* fs.stat(fullPath)
		if (info.type !== "File") {
			return skipNone<ReadableFile>()
		}
		if (info.size > FileSystem.Size(MAX_CHECKPOINT_FILE_SIZE)) {
			return skipNone<ReadableFile>()
		}
		const content = yield* fs.readFileString(fullPath)
		const contentHash = yield* sha256Hex(crypto, content)
		return Option.some({
			relativePath,
			content,
			contentHash,
			fileSize: utf8Bytes(content).byteLength
		})
	})

	const collectFiles = Effect.fn("CheckpointService.collectFiles")(function*(
		projectPath: string,
		worktreePath: string | null,
		modifiedFiles: ReadonlyArray<string>
	) {
		const relativeFiles = yield* Effect.forEach(modifiedFiles, (filePath) =>
			toRelativeModifiedPath(fs, path, filePath, projectPath, worktreePath).pipe(
				Effect.map(Option.some),
				Effect.orElseSucceed(skipNone<string>)
			)
		)
		const readable = yield* Effect.forEach(
			Arr.getSomes(relativeFiles),
			(relativePath) =>
				readOneFile(projectPath, relativePath).pipe(Effect.orElseSucceed(skipNone<ReadableFile>)),
			{ concurrency: "unbounded" }
		)
		return Arr.getSomes(readable)
	})

	const persistCheckpoint = Effect.fn("CheckpointService.persistCheckpoint")(function*(
		input: CreateCheckpointInput,
		files: ReadonlyArray<ReadableFile>
	) {
		let checkpointNumber = yield* nextCheckpointNumber(sql, input.sessionId)
		let attempt = 0
		while (attempt < MAX_CHECKPOINT_RETRIES) {
			const snapshots: Array<FileSnapshotInsert> = []
			for (const file of files) {
				const previous = yield* getPreviousFileContent(
					sql,
					input.sessionId,
					file.relativePath,
					checkpointNumber
				)
				const stats = computeDiffStats(
					Option.match(previous, { onNone: () => null, onSome: (content) => content }),
					file.content
				)
				snapshots.push({
					id: yield* crypto.randomUUIDv4,
					filePath: file.relativePath,
					contentHash: file.contentHash,
					content: file.content,
					fileSize: file.fileSize,
					linesAdded: stats.linesAdded,
					linesRemoved: stats.linesRemoved
				})
			}
			const now = yield* DateTime.now
			const inserted = yield* insertCheckpoint(sql, {
				checkpointId: CheckpointId.make(yield* crypto.randomUUIDv4),
				sessionId: input.sessionId,
				checkpointNumber,
				name: input.name,
				createdAt: now.pipe(DateTime.toEpochMillis),
				toolCallId: input.toolCallId,
				isAuto: input.isAuto,
				snapshots
			}).pipe(Effect.result)
			if (Result.isSuccess(inserted)) {
				return inserted.success
			}
			if (Schema.is(SqlError)(inserted.failure) && isUniqueConstraintError(inserted.failure)) {
				attempt = attempt + 1
				checkpointNumber = yield* nextCheckpointNumber(sql, input.sessionId)
				continue
			}
			return yield* inserted.failure
		}
		return yield* new CheckpointConflictError({ sessionId: input.sessionId })
	})

	const create = Effect.fn("CheckpointService.create")(function*(input: CreateCheckpointInput) {
		const decoded = yield* decodeCreateInput(input)
		const files = yield* collectFiles(decoded.projectPath, decoded.worktreePath, decoded.modifiedFiles)
		if (Arr.isReadonlyArrayNonEmpty(files) === false) {
			return yield* new CheckpointEmptyError({ sessionId: decoded.sessionId })
		}
		const record = yield* persistCheckpoint(decoded, files)
		yield* dispatchCreated(record)
		yield* dispatchReady(record)
		return record
	})

	const writeValidated = Effect.fn("CheckpointService.writeValidated")(function*(
		fullPath: string,
		content: string
	) {
		yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true })
		return yield* fs.writeFileString(fullPath, content).pipe(Effect.asVoid)
	})

	const revert = Effect.fn("CheckpointService.revert")(function*(input: RevertCheckpointInput) {
		const checkpoint = yield* requireOwned(input.sessionId, input.checkpointId)
		const snapshots = yield* getStoredFileSnapshots(sql, checkpoint.id)
		const effectivePath = input.worktreePath === null ? input.projectPath : input.worktreePath
		if (Arr.isReadonlyArrayNonEmpty(snapshots)) {
			const safetyName = yield* decodeSafetyName(
				`Before revert to checkpoint #${checkpoint.checkpointNumber}`
			)
			yield* create({
				sessionId: checkpoint.sessionId,
				projectPath: effectivePath,
				worktreePath: null,
				modifiedFiles: Arr.map(snapshots, (snapshot) => snapshot.filePath),
				toolCallId: PRE_REVERT_SAFETY_TOOL_CALL_ID,
				name: safetyName,
				isAuto: true
			}).pipe(Effect.option)
		}
		if (Arr.isReadonlyArrayNonEmpty(snapshots) === false) {
			yield* dispatchReverted(checkpoint)
			return {
				success: true,
				revertedFiles: Arr.empty<string>(),
				failedFiles: Arr.empty<RevertError>()
			}
		}
		const tempDir = yield* fs.makeTempDirectory()
		const prepared: Array<{
			readonly tempPath: string
			readonly finalPath: string
			readonly filePath: string
		}> = []
		const failedFiles: Array<RevertError> = []
		for (const snapshot of snapshots) {
			const finalPath = yield* validateRelativePath(fs, path, effectivePath, snapshot.filePath).pipe(
				Effect.option
			)
			if (Option.isNone(finalPath)) {
				failedFiles.push({
					filePath: snapshot.filePath,
					error: `Invalid path: ${snapshot.filePath}`
				})
				continue
			}
			const content = yield* getStoredFileContent(sql, checkpoint.id, snapshot.filePath)
			if (Option.isNone(content)) {
				failedFiles.push({
					filePath: snapshot.filePath,
					error: "File content not found in checkpoint"
				})
				continue
			}
			const tempPath = path.join(tempDir, snapshot.filePath)
			const wrote = yield* writeValidated(tempPath, content.value).pipe(Effect.option)
			if (Option.isNone(wrote)) {
				failedFiles.push({
					filePath: snapshot.filePath,
					error: `Failed to write to temp: ${snapshot.filePath}`
				})
				continue
			}
			prepared.push({
				tempPath,
				finalPath: finalPath.value,
				filePath: snapshot.filePath
			})
		}
		if (failedFiles.length > 0) {
			yield* fs.remove(tempDir, { recursive: true, force: true })
			return {
				success: false,
				revertedFiles: Arr.empty<string>(),
				failedFiles
			}
		}
		const revertedFiles: Array<string> = []
		for (const file of prepared) {
			yield* fs.makeDirectory(path.dirname(file.finalPath), { recursive: true }).pipe(Effect.option)
			const copied = yield* fs.copyFile(file.tempPath, file.finalPath).pipe(Effect.option)
			if (Option.isNone(copied)) {
				failedFiles.push({
					filePath: file.filePath,
					error: `Failed to copy file: ${file.filePath}`
				})
				continue
			}
			revertedFiles.push(file.filePath)
		}
		yield* fs.remove(tempDir, { recursive: true, force: true })
		const result: RevertResult = {
			success: failedFiles.length === 0,
			revertedFiles,
			failedFiles
		}
		if (result.success === false) {
			return result
		}
		yield* dispatchReverted(checkpoint)
		return result
	})

	const revertFile = Effect.fn("CheckpointService.revertFile")(function*(input: RevertFileInput) {
		yield* requireOwned(input.sessionId, input.checkpointId)
		const effectivePath = input.worktreePath === null ? input.projectPath : input.worktreePath
		const fullPath = yield* validateRelativePath(fs, path, effectivePath, input.filePath)
		const content = yield* getStoredFileContent(sql, input.checkpointId, input.filePath)
		if (Option.isNone(content)) {
			return yield* new CheckpointFileMissingError({
				checkpointId: input.checkpointId,
				filePath: input.filePath
			})
		}
		return yield* writeValidated(fullPath, content.value)
	})

	const getFileContent = Effect.fn("CheckpointService.getFileContent")(function*(
		sessionId: SessionId,
		checkpointId: CheckpointId,
		filePath: string
	) {
		yield* requireOwned(sessionId, checkpointId)
		const content = yield* getStoredFileContent(sql, checkpointId, filePath)
		if (Option.isNone(content)) {
			return yield* new CheckpointFileMissingError({ checkpointId, filePath })
		}
		return content.value
	})

	const getFileSnapshots = Effect.fn("CheckpointService.getFileSnapshots")(function*(
		sessionId: SessionId,
		checkpointId: CheckpointId
	) {
		yield* requireOwned(sessionId, checkpointId)
		return yield* getStoredFileSnapshots(sql, checkpointId)
	})

	const getFileDiffContent = Effect.fn("CheckpointService.getFileDiffContent")(function*(
		sessionId: SessionId,
		checkpointId: CheckpointId,
		filePath: string
	) {
		const checkpoint = yield* requireOwned(sessionId, checkpointId)
		const previous = yield* getPreviousFileContent(
			sql,
			sessionId,
			filePath,
			checkpoint.checkpointNumber
		)
		const current = yield* getStoredFileContent(sql, checkpointId, filePath)
		if (Option.isNone(current)) {
			return yield* new CheckpointFileMissingError({ checkpointId, filePath })
		}
		return {
			oldContent: Option.match(previous, { onNone: () => null, onSome: (value) => value }),
			newContent: current.value
		}
	})

	return CheckpointService.of({
		create,
		revert,
		revertFile,
		list: Effect.fn("CheckpointService.list")(function*(sessionId) {
			return yield* listStoredCheckpoints(sql, sessionId)
		}),
		get: Effect.fn("CheckpointService.get")(function*(checkpointId) {
			return yield* getStoredCheckpoint(sql, checkpointId)
		}),
		getFileContent,
		getFileSnapshots,
		getFileDiffContent
	})
})

export const CheckpointServiceLive = Layer.effect(CheckpointService, makeCheckpointService())

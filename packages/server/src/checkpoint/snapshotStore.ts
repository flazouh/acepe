import {
	CheckpointId,
	CheckpointNumber,
	SessionId,
	ToolCallId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	type CheckpointRecord,
	CheckpointNotFoundError,
	type FileSnapshot
} from "./Services/CheckpointService.ts"

const SqliteFlag = Schema.Literals([0, 1])
const SqliteInteger = Schema.Union([Schema.Number, Schema.BigInt])
const SqliteNullInteger = Schema.NullOr(SqliteInteger)

const toNumber = (value: number | bigint): number => Number(value)

const toNullNumber = (value: number | bigint | null): number | null => {
	if (value === null) {
		return null
	}
	return Number(value)
}

const CheckpointRow = Schema.Struct({
	id: CheckpointId,
	session_id: SessionId,
	checkpoint_number: SqliteInteger,
	name: Schema.NullOr(Schema.String),
	created_at: SqliteInteger,
	tool_call_id: Schema.NullOr(Schema.String),
	is_auto: SqliteFlag
})
type CheckpointRow = typeof CheckpointRow.Type

const FileSnapshotRow = Schema.Struct({
	id: TrimmedNonEmptyString,
	checkpoint_id: CheckpointId,
	file_path: TrimmedNonEmptyString,
	content_hash: TrimmedNonEmptyString,
	content: Schema.String,
	file_size: SqliteInteger,
	lines_added: SqliteNullInteger,
	lines_removed: SqliteNullInteger
})
type FileSnapshotRow = typeof FileSnapshotRow.Type

const StatsRow = Schema.Struct({
	checkpoint_id: CheckpointId,
	file_count: SqliteInteger,
	sum_added: SqliteNullInteger,
	sum_removed: SqliteNullInteger
})
type StatsRow = typeof StatsRow.Type

const NextNumberRow = Schema.Struct({
	next_number: SqliteInteger
})

const ContentRow = Schema.Struct({
	content: Schema.String
})

const decodeCheckpointRows = Schema.decodeUnknownEffect(Schema.Array(CheckpointRow))
const decodeSnapshotRows = Schema.decodeUnknownEffect(Schema.Array(FileSnapshotRow))
const decodeStatsRows = Schema.decodeUnknownEffect(Schema.Array(StatsRow))
const decodeNextNumberRows = Schema.decodeUnknownEffect(Schema.Array(NextNumberRow))
const decodeContentRows = Schema.decodeUnknownEffect(Schema.Array(ContentRow))
const decodeName = Schema.decodeUnknownEffect(Schema.NullOr(TrimmedNonEmptyString))
const decodeToolCallId = Schema.decodeUnknownEffect(Schema.NullOr(ToolCallId))
const decodeFileCount = Schema.decodeUnknownEffect(
	Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
)
const decodeCheckpointNumber = Schema.decodeUnknownEffect(CheckpointNumber)

export type FileSnapshotInsert = {
	readonly id: string
	readonly filePath: string
	readonly contentHash: string
	readonly content: string
	readonly fileSize: number
	readonly linesAdded: number | null
	readonly linesRemoved: number | null
}

const blankToNull = (value: string | null): string | null => {
	if (value === null || value === "") {
		return null
	}
	return value
}

const sqliteFlag = (isAuto: boolean): 0 | 1 => {
	if (isAuto) {
		return 1
	}
	return 0
}

const lineTotals = (
	snapshots: ReadonlyArray<FileSnapshotInsert>
): {
	readonly totalLinesAdded: number | null
	readonly totalLinesRemoved: number | null
} => {
	let totalAdded: number | null = null
	let totalRemoved: number | null = null
	for (const snapshot of snapshots) {
		if (snapshot.linesAdded !== null) {
			totalAdded = (totalAdded ?? 0) + snapshot.linesAdded
		}
		if (snapshot.linesRemoved !== null) {
			totalRemoved = (totalRemoved ?? 0) + snapshot.linesRemoved
		}
	}
	return {
		totalLinesAdded: totalAdded,
		totalLinesRemoved: totalRemoved
	}
}

const recordFromRow = Effect.fn("recordFromRow")(function*(
	row: CheckpointRow,
	fileCount: number,
	totalLinesAdded: number | null,
	totalLinesRemoved: number | null
) {
	const name = yield* decodeName(blankToNull(row.name))
	const toolCallId = yield* decodeToolCallId(blankToNull(row.tool_call_id))
	const count = yield* decodeFileCount(fileCount)
	const checkpointNumber = yield* decodeCheckpointNumber(toNumber(row.checkpoint_number))
	const record: CheckpointRecord = {
		id: row.id,
		sessionId: row.session_id,
		checkpointNumber,
		name,
		createdAt: toNumber(row.created_at),
		toolCallId,
		isAuto: row.is_auto === 1,
		fileCount: count,
		totalLinesAdded,
		totalLinesRemoved
	}
	return record
})

const snapshotFromRow = (row: FileSnapshotRow): FileSnapshot => ({
	id: row.id,
	checkpointId: row.checkpoint_id,
	filePath: row.file_path,
	contentHash: row.content_hash,
	fileSize: toNumber(row.file_size),
	linesAdded: toNullNumber(row.lines_added),
	linesRemoved: toNullNumber(row.lines_removed)
})

const statsMapFromRows = (
	rows: ReadonlyArray<StatsRow>
): ReadonlyMap<
	CheckpointId,
	{
		readonly fileCount: number
		readonly totalLinesAdded: number | null
		readonly totalLinesRemoved: number | null
	}
> => {
	const entries: Array<
		readonly [
			CheckpointId,
			{
				readonly fileCount: number
				readonly totalLinesAdded: number | null
				readonly totalLinesRemoved: number | null
			}
		]
	> = rows.map((row) => [
		row.checkpoint_id,
		{
			fileCount: toNumber(row.file_count),
			totalLinesAdded: toNullNumber(row.sum_added),
			totalLinesRemoved: toNullNumber(row.sum_removed)
		}
	])
	return new Map(entries)
}

export const listStoredCheckpoints = Effect.fn("listStoredCheckpoints")(function*(
	sql: SqlClient.SqlClient,
	sessionId: SessionId
) {
	const rows = yield* sql`
		SELECT
			id,
			session_id,
			checkpoint_number,
			name,
			created_at,
			tool_call_id,
			is_auto
		FROM checkpoints
		WHERE session_id = ${sessionId}
		ORDER BY checkpoint_number DESC
	`.withoutTransform
	const decoded = yield* decodeCheckpointRows(rows)
	if (Arr.isReadonlyArrayNonEmpty(decoded) === false) {
		return Arr.empty<CheckpointRecord>()
	}
	const ids = Arr.map(decoded, (row) => row.id)
	const statsRows = yield* sql`
		SELECT
			checkpoint_id,
			COUNT(id) AS file_count,
			SUM(lines_added) AS sum_added,
			SUM(lines_removed) AS sum_removed
		FROM file_snapshots
		WHERE checkpoint_id IN ${sql.in(ids)}
		GROUP BY checkpoint_id
	`.withoutTransform
	const stats = statsMapFromRows(yield* decodeStatsRows(statsRows))
	return yield* Effect.forEach(decoded, (row) => {
		const found = stats.get(row.id)
		if (found === undefined) {
			return recordFromRow(row, 0, null, null)
		}
		return recordFromRow(row, found.fileCount, found.totalLinesAdded, found.totalLinesRemoved)
	})
})

export const getStoredCheckpoint = Effect.fn("getStoredCheckpoint")(function*(
	sql: SqlClient.SqlClient,
	checkpointId: CheckpointId
) {
	const rows = yield* sql`
		SELECT
			id,
			session_id,
			checkpoint_number,
			name,
			created_at,
			tool_call_id,
			is_auto
		FROM checkpoints
		WHERE id = ${checkpointId}
	`.withoutTransform
	const decoded = yield* decodeCheckpointRows(rows)
	const head = Arr.head(decoded)
	if (Option.isNone(head)) {
		return yield* new CheckpointNotFoundError({ checkpointId })
	}
	const statsRows = yield* sql`
		SELECT
			checkpoint_id,
			COUNT(id) AS file_count,
			SUM(lines_added) AS sum_added,
			SUM(lines_removed) AS sum_removed
		FROM file_snapshots
		WHERE checkpoint_id = ${checkpointId}
	`.withoutTransform
	const statsDecoded = yield* decodeStatsRows(statsRows)
	const stats = Arr.head(statsDecoded)
	if (Option.isNone(stats) || toNumber(stats.value.file_count) === 0) {
		return yield* recordFromRow(head.value, 0, null, null)
	}
	return yield* recordFromRow(
		head.value,
		toNumber(stats.value.file_count),
		toNullNumber(stats.value.sum_added),
		toNullNumber(stats.value.sum_removed)
	)
})

export const nextCheckpointNumber = Effect.fn("nextCheckpointNumber")(function*(
	sql: SqlClient.SqlClient,
	sessionId: SessionId
) {
	const rows = yield* sql`
		SELECT COALESCE(MAX(checkpoint_number), 0) + 1 AS next_number
		FROM checkpoints
		WHERE session_id = ${sessionId}
	`.withoutTransform
	const decoded = yield* decodeNextNumberRows(rows)
	const head = Arr.head(decoded)
	const value = Option.match(head, {
		onNone: () => 1,
		onSome: (row) => toNumber(row.next_number)
	})
	return yield* decodeCheckpointNumber(value)
})

export const getStoredFileSnapshots = Effect.fn("getStoredFileSnapshots")(function*(
	sql: SqlClient.SqlClient,
	checkpointId: CheckpointId
) {
	const rows = yield* sql`
		SELECT
			id,
			checkpoint_id,
			file_path,
			content_hash,
			content,
			file_size,
			lines_added,
			lines_removed
		FROM file_snapshots
		WHERE checkpoint_id = ${checkpointId}
		ORDER BY file_path ASC
	`.withoutTransform
	const decoded = yield* decodeSnapshotRows(rows)
	return Arr.map(decoded, snapshotFromRow)
})

export const getStoredFileContent = Effect.fn("getStoredFileContent")(function*(
	sql: SqlClient.SqlClient,
	checkpointId: CheckpointId,
	filePath: string
) {
	const rows = yield* sql`
		SELECT content
		FROM file_snapshots
		WHERE checkpoint_id = ${checkpointId}
			AND file_path = ${filePath}
	`.withoutTransform
	const decoded = yield* decodeContentRows(rows)
	return Arr.head(decoded).pipe(Option.map((row) => row.content))
})

export const getPreviousFileContent = Effect.fn("getPreviousFileContent")(function*(
	sql: SqlClient.SqlClient,
	sessionId: SessionId,
	filePath: string,
	beforeCheckpointNumber: CheckpointNumber
) {
	const rows = yield* sql`
		SELECT
			id,
			session_id,
			checkpoint_number,
			name,
			created_at,
			tool_call_id,
			is_auto
		FROM checkpoints
		WHERE session_id = ${sessionId}
			AND checkpoint_number < ${beforeCheckpointNumber}
		ORDER BY checkpoint_number DESC
	`.withoutTransform
	const decoded = yield* decodeCheckpointRows(rows)
	for (const row of decoded) {
		const content = yield* getStoredFileContent(sql, row.id, filePath)
		if (Option.isSome(content)) {
			return content
		}
	}
	return Option.none()
})

export const insertCheckpoint = Effect.fn("insertCheckpoint")(function*(
	sql: SqlClient.SqlClient,
	input: {
		readonly checkpointId: CheckpointId
		readonly sessionId: SessionId
		readonly checkpointNumber: CheckpointNumber
		readonly name: TrimmedNonEmptyString | null
		readonly createdAt: number
		readonly toolCallId: ToolCallId | null
		readonly isAuto: boolean
		readonly snapshots: ReadonlyArray<FileSnapshotInsert>
	}
) {
	const totals = lineTotals(input.snapshots)
	const insertRow = sql`
		INSERT INTO checkpoints (
			id,
			session_id,
			checkpoint_number,
			name,
			created_at,
			tool_call_id,
			is_auto
		) VALUES (
			${input.checkpointId},
			${input.sessionId},
			${input.checkpointNumber},
			${input.name},
			${input.createdAt},
			${input.toolCallId},
			${sqliteFlag(input.isAuto)}
		)
	`.withoutTransform.pipe(Effect.asVoid)
	const insertSnapshots = Effect.forEach(
		input.snapshots,
		(snapshot) =>
			sql`
				INSERT INTO file_snapshots (
					id,
					checkpoint_id,
					file_path,
					content_hash,
					content,
					file_size,
					lines_added,
					lines_removed
				) VALUES (
					${snapshot.id},
					${input.checkpointId},
					${snapshot.filePath},
					${snapshot.contentHash},
					${snapshot.content},
					${snapshot.fileSize},
					${snapshot.linesAdded},
					${snapshot.linesRemoved}
				)
			`.withoutTransform.pipe(Effect.asVoid),
		{ discard: true }
	)
	yield* sql.withTransaction(insertRow.pipe(Effect.andThen(insertSnapshots)))
	const fileCount = yield* decodeFileCount(input.snapshots.length)
	const record: CheckpointRecord = {
		id: input.checkpointId,
		sessionId: input.sessionId,
		checkpointNumber: input.checkpointNumber,
		name: input.name,
		createdAt: input.createdAt,
		toolCallId: input.toolCallId,
		isAuto: input.isAuto,
		fileCount,
		totalLinesAdded: totals.totalLinesAdded,
		totalLinesRemoved: totals.totalLinesRemoved
	}
	return record
})

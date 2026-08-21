import {
	CheckpointId,
	type OrchestrationEvent,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	checkpointIdFromEvent,
	decodeStoredProjectedCheckpoint,
	decodeStoredProjectedCheckpoints,
	evolveProjectedCheckpoint,
	MAX_PROJECTED_CHECKPOINTS_PER_SESSION,
	PROJECTION_CHECKPOINTS_NAME,
	type ProjectedCheckpoint,
	ProjectionCheckpoints
} from "../Services/ProjectionCheckpoints.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const sqliteFlag = (isAuto: boolean): 0 | 1 => {
	if (isAuto) {
		return 1
	}
	return 0
}

const readById = Effect.fn("ProjectionCheckpoints.readById")(function*(
	tx: SqlClient.SqlClient,
	checkpointId: CheckpointId
) {
	const rows = yield* tx`
		SELECT
			checkpoint_id,
			session_id,
			sequence,
			checkpoint_number,
			name,
			is_auto,
			tool_call_id,
			file_count,
			status,
			created_at,
			last_reverted_at
		FROM projection_checkpoints
		WHERE checkpoint_id = ${checkpointId}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedCheckpoint(row).pipe(Effect.map(Option.some))
	})
})

const readCurrent = Effect.fn("ProjectionCheckpoints.readCurrent")(function*(
	tx: SqlClient.SqlClient,
	event: OrchestrationEvent
) {
	const checkpointId = checkpointIdFromEvent(event)
	if (Option.isNone(checkpointId)) {
		return Option.none()
	}
	return yield* readById(tx, checkpointId.value)
})

const upsert = Effect.fn("ProjectionCheckpoints.upsert")(function*(
	tx: SqlClient.SqlClient,
	checkpoint: ProjectedCheckpoint
) {
	yield* tx`
		INSERT INTO projection_checkpoints (
			checkpoint_id,
			session_id,
			sequence,
			checkpoint_number,
			name,
			is_auto,
			tool_call_id,
			file_count,
			status,
			created_at,
			last_reverted_at
		) VALUES (
			${checkpoint.checkpointId},
			${checkpoint.sessionId},
			${checkpoint.sequence},
			${checkpoint.checkpointNumber},
			${checkpoint.name},
			${sqliteFlag(checkpoint.isAuto)},
			${checkpoint.toolCallId},
			${checkpoint.fileCount},
			${checkpoint.status},
			${checkpoint.createdAt},
			${checkpoint.lastRevertedAt}
		)
		ON CONFLICT(checkpoint_id) DO UPDATE SET
			session_id = excluded.session_id,
			sequence = excluded.sequence,
			checkpoint_number = excluded.checkpoint_number,
			name = excluded.name,
			is_auto = excluded.is_auto,
			tool_call_id = excluded.tool_call_id,
			file_count = excluded.file_count,
			status = excluded.status,
			created_at = excluded.created_at,
			last_reverted_at = excluded.last_reverted_at
	`.withoutTransform.pipe(Effect.asVoid)
})

const pruneSession = Effect.fn("ProjectionCheckpoints.pruneSession")(function*(
	tx: SqlClient.SqlClient,
	sessionId: SessionId
) {
	yield* tx`
		DELETE FROM projection_checkpoints
		WHERE session_id = ${sessionId}
			AND checkpoint_id NOT IN (
				SELECT checkpoint_id
				FROM projection_checkpoints
				WHERE session_id = ${sessionId}
				ORDER BY checkpoint_number DESC
				LIMIT ${MAX_PROJECTED_CHECKPOINTS_PER_SESSION}
			)
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionCheckpointsLive = Layer.effect(ProjectionCheckpoints)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_CHECKPOINTS_NAME)

		const apply = Effect.fn("ProjectionCheckpoints.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current = yield* readCurrent(tx, event)
			const next = yield* evolveProjectedCheckpoint(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
			yield* pruneSession(tx, next.value.sessionId)
		})

		const truncate = Effect.fn("ProjectionCheckpoints.truncate")(function*(
			tx: SqlClient.SqlClient
		) {
			yield* tx`DELETE FROM projection_checkpoints`.withoutTransform.pipe(Effect.asVoid)
		})

		const listBySession = Effect.fn("ProjectionCheckpoints.listBySession")(function*(
			sessionId: SessionId
		) {
			const rows = yield* sql`
				SELECT
					checkpoint_id,
					session_id,
					sequence,
					checkpoint_number,
					name,
					is_auto,
					tool_call_id,
					file_count,
					status,
					created_at,
					last_reverted_at
				FROM projection_checkpoints
				WHERE session_id = ${sessionId}
				ORDER BY checkpoint_number ASC
			`.withoutTransform
			return yield* decodeStoredProjectedCheckpoints(rows)
		})

		const get = Effect.fn("ProjectionCheckpoints.get")(function*(checkpointId: CheckpointId) {
			return yield* readById(sql, checkpointId)
		})

		return ProjectionCheckpoints.of({
			name,
			apply,
			truncate,
			listBySession,
			get
		})
	})
)

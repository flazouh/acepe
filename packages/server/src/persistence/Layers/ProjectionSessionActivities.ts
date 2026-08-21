import { SessionId, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	type ActivityProjectionEvent,
	activityIdFromEvent,
	decodeProjectionSessionActivityStoredRows,
	evolveSessionActivity,
	type ProjectedSessionActivityRow,
	projectedSessionActivityFromRow,
	PROJECTION_SESSION_ACTIVITIES_NAME,
	ProjectionSessionActivities
} from "../Services/ProjectionSessionActivities.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readById = Effect.fn("ProjectionSessionActivities.readById")(function*(
	tx: SqlClient.SqlClient,
	activityId: string
) {
	const rows = yield* tx`
		SELECT
			activity_id,
			session_id,
			sequence,
			status_sequence,
			kind,
			tool_call_id,
			operation_id,
			status,
			title,
			path
		FROM projection_session_activities
		WHERE activity_id = ${activityId}
		LIMIT 1
	`.withoutTransform
	const stored = yield* decodeProjectionSessionActivityStoredRows(rows)
	return Option.map(Arr.head(stored), projectedSessionActivityFromRow)
})

const upsert = Effect.fn("ProjectionSessionActivities.upsert")(function*(
	tx: SqlClient.SqlClient,
	row: ProjectedSessionActivityRow
) {
	yield* tx`
		INSERT INTO projection_session_activities (
			activity_id,
			session_id,
			sequence,
			status_sequence,
			kind,
			tool_call_id,
			operation_id,
			status,
			title,
			path
		) VALUES (
			${row.activityId},
			${row.sessionId},
			${row.sequence},
			${row.statusSequence},
			${row.kind},
			${row.toolCallId},
			${row.operationId},
			${row.status},
			${row.title},
			${row.path}
		)
		ON CONFLICT(activity_id) DO UPDATE SET
			session_id = excluded.session_id,
			sequence = excluded.sequence,
			status_sequence = excluded.status_sequence,
			kind = excluded.kind,
			tool_call_id = excluded.tool_call_id,
			operation_id = excluded.operation_id,
			status = excluded.status,
			title = excluded.title,
			path = excluded.path
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionSessionActivitiesLive = Layer.effect(ProjectionSessionActivities)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_SESSION_ACTIVITIES_NAME)

		const apply = Effect.fn("ProjectionSessionActivities.apply")(function*(
			event: ActivityProjectionEvent,
			tx: SqlClient.SqlClient
		) {
			const activityId = activityIdFromEvent(event)
			if (Option.isNone(activityId)) {
				return
			}
			const current = yield* readById(tx, activityId.value)
			const next = yield* evolveSessionActivity(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
		})

		const truncate = Effect.fn("ProjectionSessionActivities.truncate")(
			(tx: SqlClient.SqlClient) =>
				tx`DELETE FROM projection_session_activities`.withoutTransform.pipe(Effect.asVoid)
		)

		const listBySession = Effect.fn("ProjectionSessionActivities.listBySession")(function*(
			sessionId: SessionId
		) {
			const rows = yield* sql`
				SELECT
					activity_id,
					session_id,
					sequence,
					status_sequence,
					kind,
					tool_call_id,
					operation_id,
					status,
					title,
					path
				FROM projection_session_activities
				WHERE session_id = ${sessionId}
				ORDER BY sequence ASC, activity_id ASC
			`.withoutTransform
			const stored = yield* decodeProjectionSessionActivityStoredRows(rows)
			return Arr.map(stored, projectedSessionActivityFromRow)
		})

		return ProjectionSessionActivities.of({
			name,
			apply,
			truncate,
			listBySession
		})
	})
)

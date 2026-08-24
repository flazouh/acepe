import { type OrchestrationEvent, SessionId, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredSessionReviewFiles,
	PROJECTION_SESSION_REVIEW_STATE_NAME,
	ProjectionSessionReviewState,
	reviewProjectionActionForEvent
} from "../Services/ProjectionSessionReviewState.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const sqliteFlag = (value: boolean): 0 | 1 => {
	if (value) {
		return 1
	}
	return 0
}

const upsert = Effect.fn("ProjectionSessionReviewState.upsert")(function*(
	tx: SqlClient.SqlClient,
	row: {
		readonly sessionId: SessionId
		readonly revisionKey: TrimmedNonEmptyString
		readonly filePath: TrimmedNonEmptyString
		readonly reviewed: boolean
		readonly sequence: number
	}
) {
	yield* tx`
		INSERT INTO projection_session_review_state (
			session_id,
			revision_key,
			file_path,
			reviewed,
			sequence
		) VALUES (
			${row.sessionId},
			${row.revisionKey},
			${row.filePath},
			${sqliteFlag(row.reviewed)},
			${row.sequence}
		)
		ON CONFLICT(session_id, revision_key) DO UPDATE SET
			file_path = excluded.file_path,
			reviewed = excluded.reviewed,
			sequence = excluded.sequence
	`.withoutTransform.pipe(Effect.asVoid)
})

const clearSession = Effect.fn("ProjectionSessionReviewState.clearSession")(function*(
	tx: SqlClient.SqlClient,
	sessionId: SessionId
) {
	yield* tx`
		DELETE FROM projection_session_review_state WHERE session_id = ${sessionId}
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionSessionReviewStateLive = Layer.effect(ProjectionSessionReviewState)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_SESSION_REVIEW_STATE_NAME)

		const apply = Effect.fn("ProjectionSessionReviewState.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const action = reviewProjectionActionForEvent(event)
			if (action.kind === "noop") {
				return
			}
			if (action.kind === "upsert") {
				yield* upsert(tx, action.row)
				return
			}
			yield* clearSession(tx, action.sessionId)
		})

		const truncate = Effect.fn("ProjectionSessionReviewState.truncate")(function*(
			tx: SqlClient.SqlClient
		) {
			yield* tx`DELETE FROM projection_session_review_state`.withoutTransform.pipe(Effect.asVoid)
		})

		const listBySession = Effect.fn("ProjectionSessionReviewState.listBySession")(function*(
			sessionId: SessionId
		) {
			const rows = yield* sql`
				SELECT session_id, revision_key, file_path, reviewed, sequence
				FROM projection_session_review_state
				WHERE session_id = ${sessionId}
				ORDER BY revision_key ASC
			`.withoutTransform
			return yield* decodeStoredSessionReviewFiles(rows)
		})

		return ProjectionSessionReviewState.of({
			name,
			apply,
			truncate,
			listBySession
		})
	})
)

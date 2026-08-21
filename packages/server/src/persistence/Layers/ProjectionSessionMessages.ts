import type { OrchestrationEvent, SessionId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeProjectedMessage,
	decodeProjectionSessionMessageStoredRows,
	encodeContentJson,
	nextAssistantFromToken,
	type ProjectionSessionMessage,
	ProjectionSessionMessages,
	rowFromEvent
} from "../Services/ProjectionSessionMessages.ts"

export const ProjectionSessionMessagesLive = Layer.effect(ProjectionSessionMessages)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient

		const upsert = Effect.fn("ProjectionSessionMessages.upsert")(function*(
			row: ProjectionSessionMessage,
			tx: SqlClient.SqlClient
		) {
			const content = yield* encodeContentJson(row)
			yield* tx`
				INSERT INTO projection_session_messages (
					session_id,
					sequence,
					message_id,
					turn_id,
					row_type,
					content
				) VALUES (
					${row.sessionId},
					${row.sequence},
					${row.messageId},
					${row.turnId},
					${row.rowType},
					${content}
				)
				ON CONFLICT(session_id, sequence) DO UPDATE SET
					message_id = excluded.message_id,
					turn_id = excluded.turn_id,
					row_type = excluded.row_type,
					content = excluded.content
			`.withoutTransform.pipe(Effect.asVoid)
		})

		const findAssistant = Effect.fn("ProjectionSessionMessages.findAssistant")(function*(
			sessionId: SessionId,
			messageId: string,
			tx: SqlClient.SqlClient
		) {
			const rows = yield* tx`
				SELECT
					session_id,
					sequence,
					message_id,
					turn_id,
					row_type,
					content
				FROM projection_session_messages
				WHERE session_id = ${sessionId}
					AND message_id = ${messageId}
					AND row_type = 'assistant'
				LIMIT 1
			`.withoutTransform
			const stored = yield* decodeProjectionSessionMessageStoredRows(rows)
			return yield* Option.match(Arr.head(stored), {
				onNone: () => Effect.succeed(Option.none()),
				onSome: (row) => decodeProjectedMessage(row).pipe(Effect.map(Option.some))
			})
		})

		const applyToken = Effect.fn("ProjectionSessionMessages.applyToken")(function*(
			event: Extract<OrchestrationEvent, { readonly type: "TokenAppended" }>,
			tx: SqlClient.SqlClient
		) {
			const current = yield* findAssistant(event.payload.sessionId, event.payload.messageId, tx)
			const row = yield* nextAssistantFromToken(event, current)
			yield* upsert(row, tx)
		})

		const apply = Effect.fn("ProjectionSessionMessages.apply")(
			(event: OrchestrationEvent, tx: SqlClient.SqlClient) => {
				if (event.type === "TokenAppended") {
					return applyToken(event, tx)
				}
				return Option.match(rowFromEvent(event), {
					onNone: () => Effect.void,
					onSome: (row) => upsert(row, tx)
				})
			}
		)

		const truncate = Effect.fn("ProjectionSessionMessages.truncate")(
			(tx: SqlClient.SqlClient) =>
				tx`DELETE FROM projection_session_messages`.withoutTransform.pipe(Effect.asVoid)
		)

		const listBySession = Effect.fn("ProjectionSessionMessages.listBySession")(function*(
			sessionId: SessionId
		) {
			const rows = yield* sql`
				SELECT
					session_id,
					sequence,
					message_id,
					turn_id,
					row_type,
					content
				FROM projection_session_messages
				WHERE session_id = ${sessionId}
				ORDER BY sequence ASC
			`.withoutTransform
			const stored = yield* decodeProjectionSessionMessageStoredRows(rows)
			return yield* Effect.forEach(stored, decodeProjectedMessage)
		})

		return ProjectionSessionMessages.of({
			apply,
			truncate,
			upsert,
			listBySession
		})
	})
)

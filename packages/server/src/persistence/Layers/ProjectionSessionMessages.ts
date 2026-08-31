import { type OrchestrationEvent, type Sequence, type SessionId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeProjectedMessage,
	decodeProjectionSessionMessageStoredRows,
	encodeContentJson,
	nextAssistantFromStream,
	type ProjectionSessionMessage,
	ProjectionSessionMessages,
	rowFromEvent
} from "../Services/ProjectionSessionMessages.ts"

// The stored assistant row plus how far its fold has got: `lastSequence` is
// the highest streamed-slice (TokenAppended/ThoughtAppended) sequence
// already appended to `message`.
type AssistantFold = {
	readonly message: ProjectionSessionMessage
	readonly lastSequence: Sequence
}

export const ProjectionSessionMessagesLive = Layer.effect(ProjectionSessionMessages)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient

		const upsertAt = Effect.fn("ProjectionSessionMessages.upsertAt")(function*(
			row: ProjectionSessionMessage,
			lastSequence: Sequence,
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
					content,
					last_sequence
				) VALUES (
					${row.sessionId},
					${row.sequence},
					${row.messageId},
					${row.turnId},
					${row.rowType},
					${content},
					${lastSequence}
				)
				ON CONFLICT(session_id, sequence) DO UPDATE SET
					message_id = excluded.message_id,
					turn_id = excluded.turn_id,
					row_type = excluded.row_type,
					content = excluded.content,
					last_sequence = excluded.last_sequence
			`.withoutTransform.pipe(Effect.asVoid)
		})

		// A row that replaces (every row type except an assistant fold) is
		// complete at its own sequence, so that is also the last event folded
		// into it.
		const upsert = Effect.fn("ProjectionSessionMessages.upsert")(
			(row: ProjectionSessionMessage, tx: SqlClient.SqlClient) =>
				upsertAt(row, row.sequence, tx)
		)

		const findAssistantFold = Effect.fn("ProjectionSessionMessages.findAssistantFold")(function*(
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
					content,
					last_sequence
				FROM projection_session_messages
				WHERE session_id = ${sessionId}
					AND message_id = ${messageId}
					AND row_type = 'assistant'
				LIMIT 1
			`.withoutTransform
			const stored = yield* decodeProjectionSessionMessageStoredRows(rows)
			const head = Arr.head(stored)
			if (Option.isNone(head)) {
				return Option.none<AssistantFold>()
			}
			const message = yield* decodeProjectedMessage(head.value)
			// A row written before migration 0028 reads back NULL. All that is
			// known about it is the sequence of the token that created it,
			// which is the safest reading: it never claims to have folded an
			// event it may not have.
			return Option.some<AssistantFold>({
				message,
				lastSequence: head.value.last_sequence ?? head.value.sequence
			})
		})

		const applyStream = Effect.fn("ProjectionSessionMessages.applyStream")(function*(
			event: Extract<OrchestrationEvent, { readonly type: "TokenAppended" | "ThoughtAppended" }>,
			tx: SqlClient.SqlClient
		) {
			const current = yield* findAssistantFold(event.payload.sessionId, event.payload.messageId, tx)
			// Folding, unlike upserting, is not idempotent on its own: append
			// the same token twice and the row keeps both copies. The history
			// importer applies its own freshly dispatched events to this
			// projector and checkpoints them, while ProjectionPipeline applies
			// the very same events off its live queue, so one TokenAppended
			// event reaches this fold twice and the transcript showed the
			// assistant reply doubled, concatenated with no separation.
			if (Option.isSome(current) && event.sequence <= current.value.lastSequence) {
				return
			}
			const row = yield* nextAssistantFromStream(
				event,
				Option.map(current, (fold) => fold.message)
			)
			yield* upsertAt(row, event.sequence, tx)
		})

		const apply = Effect.fn("ProjectionSessionMessages.apply")(
			(event: OrchestrationEvent, tx: SqlClient.SqlClient) => {
				if (event.type === "TokenAppended" || event.type === "ThoughtAppended") {
					return applyStream(event, tx)
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
					content,
					last_sequence
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

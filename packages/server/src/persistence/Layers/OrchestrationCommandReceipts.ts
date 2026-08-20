import { CommandId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredCommandReceipt,
	type OrchestrationCommandReceipt,
	OrchestrationCommandReceipts,
	OrchestrationCommandReceiptRow,
	replayReceipt,
	rowFromReceipt
} from "../Services/OrchestrationCommandReceipts.ts"

const encodeRow = Schema.encodeEffect(OrchestrationCommandReceiptRow)

export const OrchestrationCommandReceiptsLive = Layer.effect(OrchestrationCommandReceipts)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient

		const record = Effect.fn("OrchestrationCommandReceipts.record")(function*(
			receipt: OrchestrationCommandReceipt
		) {
			const encoded = yield* encodeRow(rowFromReceipt(receipt))
			return yield* sql.withTransaction(
				sql`INSERT INTO orchestration_command_receipts ${sql.insert(encoded)}`.withoutTransform
			)
		})

		const getByCommandId = Effect.fn("OrchestrationCommandReceipts.getByCommandId")(
			function*(commandId: CommandId) {
				const rows = yield* sql`
					SELECT
						command_id,
						status,
						result_sequence,
						reason
					FROM orchestration_command_receipts
					WHERE command_id = ${commandId}
				`.withoutTransform
				return yield* Option.match(Arr.head(rows), {
					onNone: () => Effect.succeed(Option.none()),
					onSome: (row) => decodeStoredCommandReceipt(row).pipe(Effect.map(Option.some))
				})
			}
		)

		const replay = Effect.fn("OrchestrationCommandReceipts.replay")(function*(commandId: CommandId) {
			const stored = yield* getByCommandId(commandId)
			return yield* replayReceipt(stored)
		})

		return OrchestrationCommandReceipts.of({
			record,
			getByCommandId,
			replay
		})
	})
)

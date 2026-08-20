import { CommandId, Sequence, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { SqlError } from "effect/unstable/sql/SqlError"

export class OrchestrationCommandPreviouslyRejectedError extends Schema.TaggedError<
	OrchestrationCommandPreviouslyRejectedError
>()("OrchestrationCommandPreviouslyRejectedError", {
	commandId: CommandId,
	reason: TrimmedNonEmptyString
}) {}

export const OrchestrationCommandAcceptedReceipt = Schema.Struct({
	commandId: CommandId,
	status: Schema.Literal("accepted"),
	sequence: Sequence
})
export type OrchestrationCommandAcceptedReceipt = typeof OrchestrationCommandAcceptedReceipt.Type

export const OrchestrationCommandRejectedReceipt = Schema.Struct({
	commandId: CommandId,
	status: Schema.Literal("rejected"),
	reason: TrimmedNonEmptyString
})
export type OrchestrationCommandRejectedReceipt = typeof OrchestrationCommandRejectedReceipt.Type

export const OrchestrationCommandReceipt = Schema.Union([
	OrchestrationCommandAcceptedReceipt,
	OrchestrationCommandRejectedReceipt
])
export type OrchestrationCommandReceipt = typeof OrchestrationCommandReceipt.Type

const OrchestrationCommandAcceptedReceiptRow = Schema.Struct({
	command_id: CommandId,
	status: Schema.Literal("accepted"),
	result_sequence: Sequence,
	reason: Schema.Null
})

const OrchestrationCommandRejectedReceiptRow = Schema.Struct({
	command_id: CommandId,
	status: Schema.Literal("rejected"),
	result_sequence: Schema.Null,
	reason: TrimmedNonEmptyString
})

export const OrchestrationCommandReceiptRow = Schema.Union([
	OrchestrationCommandAcceptedReceiptRow,
	OrchestrationCommandRejectedReceiptRow
])

export class OrchestrationCommandReceipts extends Context.Service<OrchestrationCommandReceipts, {
	readonly record: (
		receipt: OrchestrationCommandReceipt
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly getByCommandId: (
		commandId: CommandId
	) => Effect.Effect<Option.Option<OrchestrationCommandReceipt>, SqlError | Schema.SchemaError>
	readonly replay: (
		commandId: CommandId
	) => Effect.Effect<
		Option.Option<Sequence>,
		OrchestrationCommandPreviouslyRejectedError | SqlError | Schema.SchemaError
	>
}>()("@acepe/server/persistence/Services/OrchestrationCommandReceipts") {}

export const receiptFromRow = (
	row: typeof OrchestrationCommandReceiptRow.Type
): OrchestrationCommandReceipt =>
	Match.value(row).pipe(
		Match.discriminatorsExhaustive("status")({
			accepted: (accepted) => ({
				commandId: accepted.command_id,
				status: "accepted" as const,
				sequence: accepted.result_sequence
			}),
			rejected: (rejected) => ({
				commandId: rejected.command_id,
				status: "rejected" as const,
				reason: rejected.reason
			})
		})
	)

export const rowFromReceipt = (
	receipt: OrchestrationCommandReceipt
): typeof OrchestrationCommandReceiptRow.Type =>
	Match.value(receipt).pipe(
		Match.discriminatorsExhaustive("status")({
			accepted: (accepted) => ({
				command_id: accepted.commandId,
				status: "accepted" as const,
				result_sequence: accepted.sequence,
				reason: null
			}),
			rejected: (rejected) => ({
				command_id: rejected.commandId,
				status: "rejected" as const,
				result_sequence: null,
				reason: rejected.reason
			})
		})
	)

const decodeRow = Schema.decodeUnknownEffect(OrchestrationCommandReceiptRow)

export const decodeStoredCommandReceipt = Effect.fn("decodeStoredCommandReceipt")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		return receiptFromRow(row)
	}
)

export const replayReceipt = Effect.fn("replayReceipt")(function*(
	receipt: Option.Option<OrchestrationCommandReceipt>
) {
	return yield* Option.match(receipt, {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (value) =>
			Match.value(value).pipe(
				Match.discriminatorsExhaustive("status")({
					accepted: (accepted) => Effect.succeed(Option.some(accepted.sequence)),
					rejected: (rejected) =>
						Effect.fail(
							new OrchestrationCommandPreviouslyRejectedError({
								commandId: rejected.commandId,
								reason: rejected.reason
							})
						)
				})
			)
	})
})

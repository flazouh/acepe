import { CommandId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
	decodeStoredCommandReceipt,
	OrchestrationCommandPreviouslyRejectedError,
	OrchestrationCommandReceipts,
	replayReceipt
} from "./OrchestrationCommandReceipts.ts"

const commandId = CommandId.make("cmd-1")

const acceptedRow = {
	command_id: "cmd-1",
	status: "accepted",
	result_sequence: 4,
	reason: null
}

const rejectedRow = {
	command_id: "cmd-1",
	status: "rejected",
	result_sequence: null,
	reason: "project already exists"
}

Vitest.describe("OrchestrationCommandReceipts", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			OrchestrationCommandReceipts.key,
			"@acepe/server/persistence/Services/OrchestrationCommandReceipts"
		)
	})
})

Vitest.describe("decodeStoredCommandReceipt", () => {
	Vitest.it.effect("decodes an accepted receipt with its sequence", () =>
		Effect.gen(function*() {
			const receipt = yield* decodeStoredCommandReceipt(acceptedRow)
			Vitest.assert.deepStrictEqual(receipt, {
				commandId,
				status: "accepted",
				sequence: 4
			})
		})
	)

	Vitest.it.effect("decodes a rejected receipt with its reason", () =>
		Effect.gen(function*() {
			const receipt = yield* decodeStoredCommandReceipt(rejectedRow)
			Vitest.assert.deepStrictEqual(receipt, {
				commandId,
				status: "rejected",
				reason: "project already exists"
			})
		})
	)

	Vitest.it.effect("surfaces an accepted row without a sequence as SchemaError", () =>
		Effect.gen(function*() {
			const error = yield* decodeStoredCommandReceipt({
				command_id: "cmd-1",
				status: "accepted",
				result_sequence: null,
				reason: null
			}).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SchemaError")
			Vitest.assert.isTrue(Schema.isSchemaError(error))
		})
	)

	Vitest.it.effect("surfaces a rejected row without a reason as SchemaError", () =>
		Effect.gen(function*() {
			const error = yield* decodeStoredCommandReceipt({
				command_id: "cmd-1",
				status: "rejected",
				result_sequence: null,
				reason: null
			}).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SchemaError")
			Vitest.assert.isTrue(Schema.isSchemaError(error))
		})
	)
})

Vitest.describe("replayReceipt", () => {
	Vitest.it.effect("returns none when no receipt exists", () =>
		Effect.gen(function*() {
			const replayed = yield* replayReceipt(Option.none())
			Vitest.assert.deepStrictEqual(replayed, Option.none())
		})
	)

	Vitest.it.effect("returns the original sequence for an accepted receipt", () =>
		Effect.gen(function*() {
			const replayed = yield* replayReceipt(
				Option.some({
					commandId,
					status: "accepted" as const,
					sequence: 4
				})
			)
			Vitest.assert.deepStrictEqual(replayed, Option.some(4))
		})
	)

	Vitest.it.effect("fails with OrchestrationCommandPreviouslyRejectedError", () =>
		Effect.gen(function*() {
			const error = yield* replayReceipt(
				Option.some({
					commandId,
					status: "rejected" as const,
					reason: "project already exists"
				})
			).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandPreviouslyRejectedError")
			Vitest.assert.isTrue(Schema.is(OrchestrationCommandPreviouslyRejectedError)(error))
			Vitest.assert.strictEqual(error.commandId, commandId)
			Vitest.assert.strictEqual(error.reason, "project already exists")
		})
	)
})

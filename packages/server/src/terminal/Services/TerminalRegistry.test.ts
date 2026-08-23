import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { TerminalId } from "@acepe/contracts"
import { TerminalRegistryLookupError } from "./TerminalRegistry.ts"

Vitest.describe("TerminalRegistryLookupError", () => {
	Vitest.it.effect("is a tagged yieldable error with a readable message", () =>
		Effect.gen(function*() {
			const terminalId = TerminalId.make("term-1")
			const error = yield* Effect.flip(new TerminalRegistryLookupError({ terminalId }))
			Vitest.assert.strictEqual(error._tag, "TerminalRegistryLookupError")
			Vitest.assert.isTrue(Schema.is(TerminalRegistryLookupError)(error))
			Vitest.assert.strictEqual(
				error.message,
				"No open terminal registered for 'term-1'."
			)
		})
	)
})

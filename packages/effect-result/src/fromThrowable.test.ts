import * as Vitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

import { fromThrowable } from "./fromThrowable.ts"

class BoundaryFailed extends Data.TaggedError("BoundaryFailed")<{
	readonly message: string
}> {}

const parseFlag = fromThrowable((flag: boolean) => {
	if (flag === false) {
		throw "nope"
	}
	return "yes"
}, (cause) => new BoundaryFailed({ message: String(cause) }))

Vitest.describe("fromThrowable", () => {
	Vitest.it.effect("succeeds when the function returns", () =>
		Effect.gen(function*() {
			const value = yield* parseFlag(true)
			Vitest.assert.strictEqual(value, "yes")
		})
	)

	Vitest.it.effect("fails when the function throws", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(parseFlag(false))
			Vitest.assert.strictEqual(error._tag, "BoundaryFailed")
			Vitest.assert.strictEqual(error.message, "nope")
		})
	)
})

import * as Vitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

import { fromPromise } from "./fromPromise.ts"

class PromiseFailed extends Data.TaggedError("PromiseFailed")<{
	readonly message: string
}> {}

Vitest.describe("fromPromise", () => {
	Vitest.it.effect("succeeds when the promise fulfills", () =>
		Effect.gen(function*() {
			const value = yield* fromPromise(
				() => Promise.resolve(42),
				(cause) => new PromiseFailed({ message: String(cause) })
			)
			Vitest.assert.strictEqual(value, 42)
		})
	)

	Vitest.it.effect("fails when the promise rejects", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				fromPromise(
					() => Promise.reject("boom"),
					(cause) => new PromiseFailed({ message: String(cause) })
				)
			)
			Vitest.assert.strictEqual(error._tag, "PromiseFailed")
			Vitest.assert.strictEqual(error.message, "boom")
		})
	)
})

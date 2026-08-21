import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { HistoryDirectoryNotFoundError, HistoryMalformedLineWarning } from "./Errors.ts"

Vitest.describe("HistoryMalformedLineWarning", () => {
	Vitest.it("is a tagged warning with path, line number, and reason", () => {
		const warning = new HistoryMalformedLineWarning({
			path: "/tmp/session.jsonl",
			lineNumber: 3,
			reason: "invalid JSON"
		})
		Vitest.assert.strictEqual(warning._tag, "HistoryMalformedLineWarning")
		Vitest.assert.strictEqual(warning.path, "/tmp/session.jsonl")
		Vitest.assert.strictEqual(warning.lineNumber, 3)
		Vitest.assert.strictEqual(warning.reason, "invalid JSON")
	})
})

Vitest.describe("HistoryDirectoryNotFoundError", () => {
	Vitest.it.effect("is a tagged yieldable error with the missing path", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new HistoryDirectoryNotFoundError({
					path: "/missing/history"
				})
			)
			Vitest.assert.strictEqual(error._tag, "HistoryDirectoryNotFoundError")
			Vitest.assert.strictEqual(error.path, "/missing/history")
			Vitest.assert.strictEqual(
				error.message,
				"History directory was not found: /missing/history"
			)
		})
	)
})

import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { FileIndexNotADirectoryError, FileIndexRootNotFoundError } from "./Errors.ts"

Vitest.describe("FileIndexRootNotFoundError", () => {
	Vitest.it.effect("is a tagged yieldable error with the missing path", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new FileIndexRootNotFoundError({
					path: "/missing/project"
				})
			)
			Vitest.assert.strictEqual(error._tag, "FileIndexRootNotFoundError")
			Vitest.assert.strictEqual(error.path, "/missing/project")
			Vitest.assert.strictEqual(
				error.message,
				"File index root was not found: /missing/project"
			)
		})
	)
})

Vitest.describe("FileIndexNotADirectoryError", () => {
	Vitest.it.effect("is a tagged yieldable error when the root is a file", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new FileIndexNotADirectoryError({
					path: "/tmp/README.md"
				})
			)
			Vitest.assert.strictEqual(error._tag, "FileIndexNotADirectoryError")
			Vitest.assert.strictEqual(error.path, "/tmp/README.md")
			Vitest.assert.strictEqual(
				error.message,
				"File index root is not a directory: /tmp/README.md"
			)
		})
	)
})

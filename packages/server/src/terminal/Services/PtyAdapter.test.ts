import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { PtySpawnError } from "./PtyAdapter.ts"

Vitest.describe("PtySpawnError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new PtySpawnError({
					adapter: "bun",
					shell: "/bin/zsh",
					detail: "ENOENT"
				})
			)
			Vitest.assert.strictEqual(error._tag, "PtySpawnError")
			Vitest.assert.isTrue(Schema.is(PtySpawnError)(error))
			Vitest.assert.strictEqual(
				error.message,
				"Failed to spawn PTY process '/bin/zsh' with bun: ENOENT"
			)
		})
	)
})

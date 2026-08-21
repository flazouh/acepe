import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	ProjectionApplyError,
	ProjectionDuplicateNameError,
	ProjectionPipeline,
	ProjectionUnknownError
} from "./ProjectionPipeline.ts"

Vitest.describe("ProjectionPipeline", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			ProjectionPipeline.key,
			"@acepe/server/orchestration/Services/ProjectionPipeline"
		)
	})
})

Vitest.describe("ProjectionUnknownError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new ProjectionUnknownError({ name: "projection.sessions" }))
			Vitest.assert.strictEqual(error._tag, "ProjectionUnknownError")
			Vitest.assert.strictEqual(
				error.message,
				"Projection pipeline has no projector named 'projection.sessions'."
			)
		})
	)
})

Vitest.describe("ProjectionDuplicateNameError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ProjectionDuplicateNameError({ name: "projection.sessions" })
			)
			Vitest.assert.strictEqual(error._tag, "ProjectionDuplicateNameError")
			Vitest.assert.strictEqual(
				error.message,
				"Projection pipeline registry has a duplicate projector named 'projection.sessions'."
			)
		})
	)
})

Vitest.describe("ProjectionApplyError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ProjectionApplyError({
					name: "projection.sessions",
					detail: "payload decode failed"
				})
			)
			Vitest.assert.strictEqual(error._tag, "ProjectionApplyError")
			Vitest.assert.strictEqual(
				error.message,
				"Projector 'projection.sessions' failed: payload decode failed"
			)
		})
	)
})

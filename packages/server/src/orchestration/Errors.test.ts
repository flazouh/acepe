import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { OrchestrationCommandInvariantError } from "./Errors.ts"

Vitest.describe("OrchestrationCommandInvariantError", () => {
	Vitest.it.effect("is a tagged yieldable error with a command-scoped message", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new OrchestrationCommandInvariantError({
					commandType: "project.create",
					detail: "Project 'project-1' already exists and cannot be created twice."
				})
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "project.create")
			Vitest.assert.strictEqual(
				error.detail,
				"Project 'project-1' already exists and cannot be created twice."
			)
			Vitest.assert.strictEqual(
				error.message,
				"Orchestration command invariant failed (project.create): Project 'project-1' already exists and cannot be created twice."
			)
		})
	)
})

import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	OrchestrationEngine,
	OrchestrationEngineShutdownError,
	orchestrationCommandAckDuration,
	orchestrationCommandDuration,
	orchestrationCommandsTotal
} from "./OrchestrationEngine.ts"

Vitest.describe("OrchestrationEngine", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			OrchestrationEngine.key,
			"@acepe/server/orchestration/Services/OrchestrationEngine"
		)
	})
})

Vitest.describe("metrics", () => {
	Vitest.it("names command count, dispatch duration, and ack duration", () => {
		Vitest.assert.strictEqual(orchestrationCommandsTotal.id, "acepe_orchestration_commands_total")
		Vitest.assert.strictEqual(orchestrationCommandDuration.id, "acepe_orchestration_command_duration")
		Vitest.assert.strictEqual(
			orchestrationCommandAckDuration.id,
			"acepe_orchestration_command_ack_duration"
		)
	})
})

Vitest.describe("OrchestrationEngineShutdownError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new OrchestrationEngineShutdownError({}))
			Vitest.assert.strictEqual(error._tag, "OrchestrationEngineShutdownError")
			Vitest.assert.strictEqual(error.message, "Orchestration engine is shut down.")
		})
	)
})

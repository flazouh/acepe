import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { decodeScenario, encodeScenario } from "../scenario.ts"
import { runScenarioToCompletion } from "../session.ts"
import { isMonotonic } from "../timeline.ts"
import { authoredScenarioByName, authoredScenarios } from "./index.ts"

Vitest.describe("authored scenarios", () => {
	Vitest.it("every scenario has a distinct name", () => {
		const names = authoredScenarios.map((scenario) => scenario.meta.name)
		Vitest.assert.strictEqual(new Set(names).size, names.length)
	})

	Vitest.it("lookup by name finds each one and nothing else", () => {
		for (const scenario of authoredScenarios) {
			Vitest.assert.strictEqual(authoredScenarioByName(scenario.meta.name), scenario)
		}
		Vitest.assert.isNull(authoredScenarioByName("no-such-scenario"))
	})

	for (const scenario of authoredScenarios) {
		Vitest.it(`${scenario.meta.name} has monotonic offsets and a library row`, () => {
			Vitest.assert.isTrue(isMonotonic(scenario.steps))
			Vitest.assert.isAbove(scenario.steps.length, 0)
			const library = scenario.snapshots.find((line) => line.scopeKey === "library")
			Vitest.assert.isAbove(library?.snapshot.sessions.length ?? 0, 0)
			Vitest.assert.isAbove(library?.snapshot.projects.length ?? 0, 0)
		})

		Vitest.it.effect(`${scenario.meta.name} survives an ndjson round trip`, () =>
			Effect.gen(function* () {
				const decoded = yield* decodeScenario(yield* encodeScenario(scenario))
				Vitest.assert.deepStrictEqual(decoded.steps, scenario.steps)
				Vitest.assert.deepStrictEqual(decoded.snapshots, scenario.snapshots)
			}),
		)

		Vitest.it.effect(`${scenario.meta.name} replays to completion`, () =>
			Effect.gen(function* () {
				const record = yield* runScenarioToCompletion(scenario)
				Vitest.assert.strictEqual(record.missingCalls.length, 0)
			}),
		)
	}
})

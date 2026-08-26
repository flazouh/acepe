import { MessageId, ProjectId, SessionId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { scenarioBuilder } from "./builder.ts"
import { makeScenarioPlayer } from "./player.ts"

const steps = scenarioBuilder({
	sessionId: SessionId.make("session-1"),
	projectId: ProjectId.make("project-1"),
	startedAt: "2026-08-27T10:00:00.000Z",
})
	.sessionCreated("Ship the slice")
	.advance(50)
	.userMessage(MessageId.make("message-1"), "Ship the slice")
	.tokens(MessageId.make("message-1:assistant"), ["Hello", " there"], 50)
	.build("paced", "50ms between events").steps

Vitest.describe("playback control", () => {
	Vitest.it.effect("a paused player emits nothing", () =>
		Effect.gen(function* () {
			const player = yield* makeScenarioPlayer(steps, { autoPlay: false, rate: 1 })
			const state = yield* player.state
			yield* player.shutdown
			Vitest.assert.strictEqual(state.mode, "paused")
			Vitest.assert.strictEqual(state.cursor, 0)
		}),
	)

	Vitest.it.effect("stepOnce emits exactly one event and stays paused", () =>
		Effect.gen(function* () {
			const player = yield* makeScenarioPlayer(steps, { autoPlay: false, rate: 1 })
			yield* player.stepOnce
			yield* player.stepOnce
			const state = yield* player.state
			yield* player.shutdown
			Vitest.assert.strictEqual(state.cursor, 2)
			Vitest.assert.strictEqual(state.mode, "paused")
		}),
	)

	Vitest.it.effect("seekTo emits everything up to the index", () =>
		Effect.gen(function* () {
			const player = yield* makeScenarioPlayer(steps, { autoPlay: false, rate: 1 })
			yield* player.seekTo(steps.length - 1)
			const state = yield* player.state
			yield* player.shutdown
			Vitest.assert.strictEqual(state.cursor, steps.length)
		}),
	)

	/**
	 * Rate 0 removes every sleep, so this completes under a test clock that
	 * never advances. A replay that still waited would hang here instead of
	 * passing, which is the assertion.
	 */
	Vitest.it.effect("rate 0 drains with no time passing at all", () =>
		Effect.gen(function* () {
			const player = yield* makeScenarioPlayer(steps, { autoPlay: true, rate: 0 })
			yield* player.awaitDrained
			const state = yield* player.state
			yield* player.shutdown
			Vitest.assert.strictEqual(state.cursor, steps.length)
		}),
	)

	Vitest.it.live("rate 1 paces the replay instead of dumping it", () =>
		Effect.gen(function* () {
			const player = yield* makeScenarioPlayer(steps, { autoPlay: true, rate: 1 })
			yield* Effect.sleep("10 millis")
			const early = yield* player.state
			yield* player.pause
			yield* Effect.sleep("120 millis")
			const afterPause = yield* player.state
			yield* player.shutdown
			Vitest.assert.isBelow(early.cursor, steps.length)
			Vitest.assert.strictEqual(afterPause.cursor, early.cursor)
		}),
	)
})

import * as Vitest from "@effect/vitest"
import * as Clock from "effect/Clock"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import {
	HISTORY_TEST_NOW,
	HistoryEngineLive,
	HistoryPlatform,
	setHistoryClock
} from "./testLive.ts"

Vitest.layer(HistoryEngineLive.pipe(Layer.provideMerge(HistoryPlatform)))(
	"HistoryEngineLive",
	(it) => {
		it.effect("starts an orchestration engine on a temp sqlite database", () =>
			Effect.gen(function*() {
				const engine = yield* OrchestrationEngine
				const sequence = yield* engine.latestSequence
				Vitest.assert.strictEqual(sequence, 0)
			})
		)

		it.effect("pins the test clock to HISTORY_TEST_NOW", () =>
			Effect.gen(function*() {
				yield* setHistoryClock(HISTORY_TEST_NOW)
				const made = DateTime.make(HISTORY_TEST_NOW)
				if (Option.isNone(made)) {
					return
				}
				const millis = yield* Clock.currentTimeMillis
				Vitest.assert.strictEqual(millis, made.value.pipe(DateTime.toEpochMillis))
			})
		)
	}
)

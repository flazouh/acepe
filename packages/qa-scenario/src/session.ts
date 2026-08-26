/**
 * One scenario, wired as a live client the app can use.
 *
 * This is the single entry point every QA level-2 caller wants: the desktop's
 * `provideAppRpcClient`, a vitest run, and the CI replay all take a
 * `ScenarioSession` and nothing else.
 */

import type { RpcClient } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import type { ScenarioPlayer, ScenarioPlayerOptions } from "./player.ts"
import { defaultPlayerOptions, makeScenarioPlayer } from "./player.ts"
import type { QaScenario } from "./scenario.ts"
import type { ScenarioTransportRecord } from "./transport.ts"
import { makeScenarioTransport } from "./transport.ts"

export type ScenarioSession = {
	readonly scenario: QaScenario
	readonly client: RpcClient
	readonly controls: ScenarioPlayer
	readonly record: Effect.Effect<ScenarioTransportRecord>
	readonly shutdown: Effect.Effect<void>
}

export const makeScenarioSession = Effect.fn("makeScenarioSession")(function* (
	scenario: QaScenario,
	options: ScenarioPlayerOptions = defaultPlayerOptions,
) {
	const controls = yield* makeScenarioPlayer(scenario.steps, options)
	const transport = yield* makeScenarioTransport(scenario, controls)
	return {
		scenario,
		client: transport.client,
		controls,
		record: transport.record,
		shutdown: controls.shutdown,
	} satisfies ScenarioSession
})

/** Replay with no waiting at all, then hand back what the app did. Built for CI. */
export const runScenarioToCompletion = Effect.fn("runScenarioToCompletion")(function* (
	scenario: QaScenario,
) {
	const session = yield* makeScenarioSession(scenario, { autoPlay: true, rate: 0 })
	yield* session.controls.awaitDrained
	const record = yield* session.record
	yield* session.shutdown
	return record
})

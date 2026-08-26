import {
	MessageId,
	ProjectId,
	SessionId,
	TrimmedNonEmptyString,
	librarySnapshotRequest,
	sessionSnapshotRequest,
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { scenarioBuilder } from "./builder.ts"
import { makeScenarioSession, runScenarioToCompletion } from "./session.ts"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")

const scenario = scenarioBuilder({
	sessionId,
	projectId,
	startedAt: "2026-08-27T10:00:00.000Z",
})
	.sessionCreated("Ship the slice")
	.advance(20)
	.userMessage(MessageId.make("message-1"), "Ship the slice")
	.tokens(MessageId.make("message-1:assistant"), ["Hello", " from", " Acepe."], 30)
	.turnCompleted()
	.build("reply", "a short streamed reply")

const instant = { autoPlay: true, rate: 0 } as const
const parked = { autoPlay: false, rate: 0 } as const

Vitest.describe("a scenario replayed as the app's client", () => {
	Vitest.it.effect("streams every recorded event in capture order", () =>
		Effect.gen(function* () {
			const session = yield* makeScenarioSession(scenario, instant)
			const seen = yield* session.client
				.events(0)
				.pipe(Stream.take(scenario.steps.length), Stream.runCollect)
			yield* session.shutdown
			Vitest.assert.deepStrictEqual(
				seen.map((event) => event.type),
				scenario.steps.map((step) => step.event.type),
			)
		}),
	)

	Vitest.it.effect("answers a session snapshot with the messages the fold produced", () =>
		Effect.gen(function* () {
			const session = yield* makeScenarioSession(scenario, parked)
			const snapshot = yield* session.client.snapshot(sessionSnapshotRequest(sessionId))
			yield* session.shutdown
			Vitest.assert.strictEqual(snapshot.session?.sessionId, sessionId)
			Vitest.assert.isAbove(snapshot.messages.length, 0)
		}),
	)

	Vitest.it.effect("a snapshot for an unrecorded scope answers empty rather than lying", () =>
		Effect.gen(function* () {
			const session = yield* makeScenarioSession(scenario, parked)
			const snapshot = yield* session.client.snapshot(
				sessionSnapshotRequest(SessionId.make("not-recorded")),
			)
			yield* session.shutdown
			Vitest.assert.isNull(snapshot.session)
			Vitest.assert.strictEqual(snapshot.messages.length, 0)
		}),
	)

	Vitest.it.effect("the library scope answers with the session row", () =>
		Effect.gen(function* () {
			const session = yield* makeScenarioSession(scenario, parked)
			const snapshot = yield* session.client.snapshot(librarySnapshotRequest())
			yield* session.shutdown
			Vitest.assert.deepStrictEqual(
				snapshot.sessions.map((row) => row.sessionId),
				[sessionId],
			)
		}),
	)

	Vitest.it.effect("a call the scenario never recorded fails and is reported as missing", () =>
		Effect.gen(function* () {
			const session = yield* makeScenarioSession(scenario, parked)
			const exit = yield* Effect.exit(
				session.client.getProjectIndex(TrimmedNonEmptyString.make("/tmp/acepe")),
			)
			const record = yield* session.record
			yield* session.shutdown
			Vitest.assert.strictEqual(exit._tag, "Failure")
			Vitest.assert.deepStrictEqual(record.missingCalls, ['getProjectIndex "/tmp/acepe"'])
		}),
	)

	Vitest.it.effect("every command the app dispatches is kept for assertion", () =>
		Effect.gen(function* () {
			const session = yield* makeScenarioSession(scenario, parked)
			const record = yield* session.record
			yield* session.shutdown
			Vitest.assert.strictEqual(record.dispatched.length, 0)
		}),
	)

	Vitest.it.effect("runScenarioToCompletion drains without waiting", () =>
		Effect.gen(function* () {
			const record = yield* runScenarioToCompletion(scenario)
			Vitest.assert.strictEqual(record.dispatched.length, 0)
		}),
	)
})

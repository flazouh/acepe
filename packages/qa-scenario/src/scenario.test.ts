import {
	MessageId,
	ProjectId,
	SessionId,
	librarySnapshotRequest,
	sessionSnapshotRequest,
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { scenarioBuilder } from "./builder.ts"
import { decodeScenario, encodeScenario, snapshotRequestKey } from "./scenario.ts"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")

const sample = scenarioBuilder({
	sessionId,
	projectId,
	startedAt: "2026-08-27T10:00:00.000Z",
})
	.sessionCreated("Ship the slice")
	.advance(20)
	.userMessage(MessageId.make("message-1"), "Ship the slice")
	.tokens(MessageId.make("message-1:assistant"), ["Hello", " from", " Acepe."], 30)
	.turnCompleted()
	.build("sample", "a short reply")

Vitest.describe("snapshotRequestKey", () => {
	Vitest.it("scopes a session request to that session", () => {
		Vitest.assert.strictEqual(
			snapshotRequestKey(sessionSnapshotRequest(sessionId)),
			"session:session-1",
		)
	})

	Vitest.it("keeps unrelated scopes apart", () => {
		Vitest.assert.strictEqual(snapshotRequestKey(librarySnapshotRequest()), "library")
		Vitest.assert.notStrictEqual(
			snapshotRequestKey(sessionSnapshotRequest(SessionId.make("other"))),
			snapshotRequestKey(sessionSnapshotRequest(sessionId)),
		)
	})
})

Vitest.describe("scenario ndjson", () => {
	Vitest.it.effect("survives a round trip unchanged", () =>
		Effect.gen(function* () {
			const text = yield* encodeScenario(sample)
			const decoded = yield* decodeScenario(text)
			Vitest.assert.strictEqual(decoded.meta.name, "sample")
			Vitest.assert.deepStrictEqual(
				decoded.steps.map((step) => step.event.type),
				sample.steps.map((step) => step.event.type),
			)
			Vitest.assert.deepStrictEqual(
				decoded.snapshots.map((line) => line.scopeKey),
				["session:session-1", "library"],
			)
		}),
	)

	Vitest.it.effect("ignores blank lines", () =>
		Effect.gen(function* () {
			const text = yield* encodeScenario(sample)
			const decoded = yield* decodeScenario(`\n${text}\n\n`)
			Vitest.assert.strictEqual(decoded.steps.length, sample.steps.length)
		}),
	)

	Vitest.it.effect("a file with no meta line is rejected", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(decodeScenario(""))
			Vitest.assert.strictEqual(exit._tag, "Failure")
		}),
	)
})

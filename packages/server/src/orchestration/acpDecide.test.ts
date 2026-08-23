import {
	CommandId,
	EventId,
	ProjectId,
	SessionId,
	SessionResumeCommand
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { OrchestrationReadModel } from "./commandInvariants.ts"
import { decideAcp } from "./acpDecide.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-acp")
const eventId = EventId.make("event-acp")
const sessionId = SessionId.make("session-1")
const identity = {
	eventId,
	occurredAt
}

const emptyReadModel: OrchestrationReadModel = {
	snapshotSequence: 0,
	projects: [],
	sessions: []
}

const withSession: OrchestrationReadModel = {
	snapshotSequence: 4,
	projects: [],
	sessions: [
		{
			id: sessionId,
			projectId: ProjectId.make("project-1"),
			archivedAt: null,
			checkpoints: []
		}
	]
}

Vitest.describe("decideAcp", () => {
	Vitest.it.effect("rejects session.resume when the session is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decideAcp(
					emptyReadModel,
					SessionResumeCommand.make({
						type: "session.resume",
						commandId,
						sessionId
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "session.resume")
		})
	)

	Vitest.it.effect("resumes an existing session", () =>
		Effect.gen(function*() {
			const events = yield* decideAcp(
				withSession,
				SessionResumeCommand.make({
					type: "session.resume",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "SessionResumed")
		})
	)
})

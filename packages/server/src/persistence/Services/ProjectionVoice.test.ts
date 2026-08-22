import {
	APP_VOICE_ID,
	CommandId,
	EventId,
	type OrchestrationEvent,
	placeholderVoiceModel,
	ProjectId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { evolveProjectedVoice, PROJECTION_VOICE_NAME, ProjectionVoice } from "./ProjectionVoice.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const modelsListed = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "voice",
	aggregateId: APP_VOICE_ID,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "VoiceModelsListed",
	payload: {
		models: [placeholderVoiceModel("external")]
	}
})

const projectCreated: OrchestrationEvent = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
}

Vitest.describe("evolveProjectedVoice", () => {
	Vitest.it.effect("projects VoiceModelsListed as a catalog", () =>
		Effect.gen(function*() {
			const next = yield* evolveProjectedVoice(Option.none(), modelsListed(2))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 2,
					models: [placeholderVoiceModel("external")],
					languages: [],
					recording: null,
					lastTranscription: null
				})
			)
		})
	)

	Vitest.it.effect("ignores project events", () =>
		Effect.gen(function*() {
			const next = yield* evolveProjectedVoice(Option.none(), projectCreated)
			Vitest.assert.deepStrictEqual(next, Option.none())
		})
	)
})

Vitest.describe("ProjectionVoice", () => {
	Vitest.it("is a service class named projection.voice", () => {
		Vitest.assert.strictEqual(ProjectionVoice.key, "@acepe/server/persistence/Services/ProjectionVoice")
		Vitest.assert.strictEqual(PROJECTION_VOICE_NAME, "projection.voice")
	})
})

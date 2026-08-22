import {
	APP_VOICE_ID,
	CommandId,
	EventId,
	VoiceLanguagesListCommand,
	VoiceModelsListCommand,
	emptyVoiceModels,
	placeholderVoiceModel
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { OrchestrationReadModel } from "./commandInvariants.ts"
import { decideVoice } from "./voiceDecide.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-voice")
const eventId = EventId.make("event-voice")
const identity = {
	eventId,
	occurredAt
}

const emptyReadModel: OrchestrationReadModel = {
	snapshotSequence: 0,
	projects: [],
	sessions: []
}

Vitest.describe("decideVoice", () => {
	Vitest.it.effect("emits VoiceModelsListed for voice.models.list", () =>
		Effect.gen(function*() {
			const events = yield* decideVoice(
				emptyReadModel,
				VoiceModelsListCommand.make({
					type: "voice.models.list",
					commandId,
					models: emptyVoiceModels
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "VoiceModelsListed")
			Vitest.assert.strictEqual(events[0]?.aggregateId, APP_VOICE_ID)
			Vitest.assert.strictEqual(events[0]?.sequence, 1)
		})
	)

	Vitest.it.effect("rejects duplicate language codes", () =>
		Effect.gen(function*() {
			const language = { code: "en", name: "English" }
			const error = yield* Effect.flip(
				decideVoice(
					emptyReadModel,
					VoiceLanguagesListCommand.make({
						type: "voice.languages.list",
						commandId,
						languages: [language, language]
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "voice.languages.list")
		})
	)

	Vitest.it.effect("rejects duplicate model ids", () =>
		Effect.gen(function*() {
			const model = placeholderVoiceModel("external")
			const error = yield* Effect.flip(
				decideVoice(
					emptyReadModel,
					VoiceModelsListCommand.make({
						type: "voice.models.list",
						commandId,
						models: [model, model]
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "voice.models.list")
		})
	)
})

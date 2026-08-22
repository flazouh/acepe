import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	ExternalSttCommandError,
	ExternalSttCommandMissingError,
	ExternalSttNotConfiguredError,
	ExternalSttNotLoadedError,
	MicrophoneUnavailableError,
	VoiceAlreadyRecordingError,
	VoiceBackendAlreadyConfiguringError,
	VoiceModelsExternalError,
	VoiceServiceStoppedError,
	VoiceUnknownBackendError,
	VoiceUnknownModelError
} from "./Errors.ts"

Vitest.describe("VoiceUnknownBackendError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new VoiceUnknownBackendError({}))
			Vitest.assert.strictEqual(error._tag, "VoiceUnknownBackendError")
			Vitest.assert.strictEqual(error.message, "Unknown voice backend")
		})
	)
})

Vitest.describe("VoiceUnknownModelError", () => {
	Vitest.it.effect("names the unknown model id", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new VoiceUnknownModelError({ modelId: "tiny" }))
			Vitest.assert.strictEqual(error.message, "Unknown model: tiny")
		})
	)
})

Vitest.describe("VoiceBackendAlreadyConfiguringError", () => {
	Vitest.it.effect("names the backend that is already configuring", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new VoiceBackendAlreadyConfiguringError({ modelId: "external" })
			)
			Vitest.assert.strictEqual(
				error.message,
				"Voice backend 'external' is already being configured"
			)
		})
	)
})

Vitest.describe("VoiceModelsExternalError", () => {
	Vitest.it.effect("tells the user to configure the STT command env", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new VoiceModelsExternalError({
					commandEnv: "ACEPE_VOICE_STT_COMMAND",
					modelPathEnv: "ACEPE_VOICE_STT_MODEL_PATH"
				})
			)
			Vitest.assert.strictEqual(
				error.message,
				"Voice models are managed outside Acepe. Configure ACEPE_VOICE_STT_COMMAND and optionally ACEPE_VOICE_STT_MODEL_PATH."
			)
		})
	)
})

Vitest.describe("VoiceAlreadyRecordingError", () => {
	Vitest.it.effect("rejects a second start", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new VoiceAlreadyRecordingError({}))
			Vitest.assert.strictEqual(error.message, "Already recording")
		})
	)
})

Vitest.describe("MicrophoneUnavailableError", () => {
	Vitest.it.effect("carries the device message", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new MicrophoneUnavailableError({ detail: "No audio input device available" })
			)
			Vitest.assert.isTrue(Schema.is(MicrophoneUnavailableError)(error))
			Vitest.assert.strictEqual(error.message, "No audio input device available")
		})
	)
})

Vitest.describe("External STT errors", () => {
	Vitest.it.effect("names a missing command env", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ExternalSttNotConfiguredError({ commandEnv: "ACEPE_VOICE_STT_COMMAND" })
			)
			Vitest.assert.strictEqual(error.message, "ACEPE_VOICE_STT_COMMAND is not configured")
		})
	)

	Vitest.it.effect("names a command path that does not exist", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ExternalSttCommandMissingError({
					commandEnv: "ACEPE_VOICE_STT_COMMAND",
					path: "/missing/stt"
				})
			)
			Vitest.assert.strictEqual(
				error.message,
				"ACEPE_VOICE_STT_COMMAND does not exist: /missing/stt"
			)
		})
	)

	Vitest.it.effect("says the backend is not loaded", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new ExternalSttNotLoadedError({}))
			Vitest.assert.strictEqual(error.message, "External STT backend is not loaded")
		})
	)

	Vitest.it.effect("appends stderr when the STT command fails", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ExternalSttCommandError({
					command: "/bin/stt",
					exitCode: 17,
					stderr: "no wav"
				})
			)
			Vitest.assert.strictEqual(
				error.message,
				"External STT command failed with status 17: no wav"
			)
		})
	)

	Vitest.it.effect("falls back to the exit code when stderr is empty", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ExternalSttCommandError({
					command: "/bin/stt",
					exitCode: 1,
					stderr: ""
				})
			)
			Vitest.assert.strictEqual(error.message, "External STT command failed with status 1")
		})
	)
})

Vitest.describe("VoiceServiceStoppedError", () => {
	Vitest.it.effect("matches the rust worker-stopped message", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new VoiceServiceStoppedError({}))
			Vitest.assert.strictEqual(error.message, "Voice worker has stopped")
		})
	)
})

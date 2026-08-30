import {
	APP_VOICE_ID,
	CommandId,
	EventId,
	type OrchestrationEvent,
	placeholderVoiceModel,
	ProjectId,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { evolveProjectedVoice, PROJECTION_VOICE_NAME, ProjectionVoice } from "./ProjectionVoice.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")

const voiceEventBase = (sequence: number) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "voice" as const,
	aggregateId: APP_VOICE_ID,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {}
})

const modelsListed = (sequence: number): OrchestrationEvent => ({
	...voiceEventBase(sequence),
	type: "VoiceModelsListed",
	payload: {
		models: [placeholderVoiceModel("external")]
	}
})

const recordingStarted = (sequence: number): OrchestrationEvent => ({
	...voiceEventBase(sequence),
	type: "VoiceRecordingStarted",
	payload: {
		sessionId
	}
})

const recordingStopped = (sequence: number): OrchestrationEvent => ({
	...voiceEventBase(sequence),
	type: "VoiceRecordingStopped",
	payload: {
		sessionId,
		language: null,
		result: {
			text: "hello",
			language: null,
			durationMs: 500
		}
	}
})

const recordingCancelled = (sequence: number): OrchestrationEvent => ({
	...voiceEventBase(sequence),
	type: "VoiceRecordingCancelled",
	payload: {
		sessionId
	}
})

const amplitudeObserved = (sequence: number): OrchestrationEvent => ({
	...voiceEventBase(sequence),
	type: "VoiceAmplitudeObserved",
	payload: {
		sessionId,
		values: [0.1, 0.2, 0.3]
	}
})

const modelDownloadProgressed = (sequence: number): OrchestrationEvent => ({
	...voiceEventBase(sequence),
	type: "VoiceModelDownloadProgressed",
	payload: {
		modelId: "external",
		downloadedBytes: 50,
		totalBytes: 100,
		percent: 50
	}
})

const modelDownloaded = (sequence: number): OrchestrationEvent => ({
	...voiceEventBase(sequence),
	type: "VoiceModelDownloaded",
	payload: {
		modelId: "external"
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
					amplitude: null,
					download: null,
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

	Vitest.it.effect("projects VoiceAmplitudeObserved without touching models or recording", () =>
		Effect.gen(function*() {
			const withRecording = yield* evolveProjectedVoice(Option.none(), recordingStarted(2))
			const next = yield* evolveProjectedVoice(withRecording, amplitudeObserved(3))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 3,
					models: [],
					languages: [],
					recording: { sessionId, phase: "recording" as const },
					amplitude: { sessionId, values: [0.1, 0.2, 0.3] },
					download: null,
					lastTranscription: null
				})
			)
		})
	)

	Vitest.it.effect("VoiceRecordingStarted clears amplitude back to null", () =>
		Effect.gen(function*() {
			const withAmplitude = yield* evolveProjectedVoice(Option.none(), amplitudeObserved(2))
			const next = yield* evolveProjectedVoice(withAmplitude, recordingStarted(3))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 3,
					models: [],
					languages: [],
					recording: { sessionId, phase: "recording" as const },
					amplitude: null,
					download: null,
					lastTranscription: null
				})
			)
		})
	)

	Vitest.it.effect("VoiceRecordingStopped clears amplitude back to null", () =>
		Effect.gen(function*() {
			const withAmplitude = yield* evolveProjectedVoice(Option.none(), amplitudeObserved(2))
			const next = yield* evolveProjectedVoice(withAmplitude, recordingStopped(3))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 3,
					models: [],
					languages: [],
					recording: null,
					amplitude: null,
					download: null,
					lastTranscription: {
						sessionId,
						text: "hello",
						language: null,
						durationMs: 500
					}
				})
			)
		})
	)

	Vitest.it.effect("VoiceRecordingCancelled clears amplitude back to null", () =>
		Effect.gen(function*() {
			const withAmplitude = yield* evolveProjectedVoice(Option.none(), amplitudeObserved(2))
			const next = yield* evolveProjectedVoice(withAmplitude, recordingCancelled(3))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 3,
					models: [],
					languages: [],
					recording: null,
					amplitude: null,
					download: null,
					lastTranscription: null
				})
			)
		})
	)

	Vitest.it.effect("projects VoiceModelDownloadProgressed with the percent", () =>
		Effect.gen(function*() {
			const next = yield* evolveProjectedVoice(Option.none(), modelDownloadProgressed(2))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 2,
					models: [],
					languages: [],
					recording: null,
					amplitude: null,
					download: {
						modelId: "external",
						downloadedBytes: 50,
						totalBytes: 100,
						percent: 50
					},
					lastTranscription: null
				})
			)
		})
	)

	Vitest.it.effect("VoiceModelDownloaded clears download back to null", () =>
		Effect.gen(function*() {
			const withDownload = yield* evolveProjectedVoice(Option.none(), modelDownloadProgressed(2))
			const next = yield* evolveProjectedVoice(withDownload, modelDownloaded(3))
			Vitest.assert.deepStrictEqual(
				next,
				Option.some({
					sequence: 3,
					models: [],
					languages: [],
					recording: null,
					amplitude: null,
					download: null,
					lastTranscription: null
				})
			)
		})
	)
})

Vitest.describe("ProjectionVoice", () => {
	Vitest.it("is a service class named projection.voice", () => {
		Vitest.assert.strictEqual(ProjectionVoice.key, "@acepe/server/persistence/Services/ProjectionVoice")
		Vitest.assert.strictEqual(PROJECTION_VOICE_NAME, "projection.voice")
	})
})

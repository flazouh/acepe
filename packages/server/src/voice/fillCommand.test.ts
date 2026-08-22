import {
	CommandId,
	emptyVoiceLanguages,
	emptyVoiceModels,
	emptyVoiceTranscriptionResult,
	placeholderVoiceModel,
	ProjectCreateCommand,
	ProjectId,
	SessionId,
	VoiceLanguagesListCommand,
	VoiceModelDeleteCommand,
	VoiceModelDownloadCommand,
	VoiceModelLoadCommand,
	VoiceModelStatusCommand,
	VoiceModelsListCommand,
	VoiceRecordingCancelCommand,
	VoiceRecordingStartCommand,
	VoiceRecordingStopCommand
} from "@acepe/contracts"
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { fillVoiceCommand } from "./fillCommand.ts"
import { EXTERNAL_BACKEND_ID, EXTERNAL_BACKEND_NAME } from "./Schemas.ts"
import { VoiceRuntimeLive } from "./Layers/VoiceRuntime.ts"

const PlatformLive = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const configLayer = ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))

const VoiceLive = VoiceRuntimeLive.pipe(Layer.provideMerge(PlatformLive), Layer.provide(configLayer))

const isolatedVoice = () => Layer.fresh(VoiceLive)

const commandId = CommandId.make("cmd-voice")
const sessionId = SessionId.make("session-1")

Vitest.layer(isolatedVoice())("fillVoiceCommand", (it) => {
	it.effect("leaves non-voice commands unchanged", () =>
		Effect.gen(function*() {
			const command = ProjectCreateCommand.make({
				type: "project.create",
				commandId: CommandId.make("cmd-project"),
				projectId: ProjectId.make("project-1"),
				title: "Acepe",
				workspaceRoot: "/tmp/acepe"
			})
			const filled = yield* fillVoiceCommand(command)
			Vitest.assert.deepStrictEqual(filled, command)
		})
	)

	it.effect("fills voice.models.list from the voice service", () =>
		Effect.gen(function*() {
			const filled = yield* fillVoiceCommand(
				VoiceModelsListCommand.make({
					type: "voice.models.list",
					commandId,
					models: emptyVoiceModels
				})
			)
			Vitest.assert.strictEqual(filled.type, "voice.models.list")
			if (filled.type === "voice.models.list") {
				Vitest.assert.strictEqual(filled.models.length, 1)
				Vitest.assert.strictEqual(filled.models[0]?.id, EXTERNAL_BACKEND_ID)
				Vitest.assert.strictEqual(filled.models[0]?.name, EXTERNAL_BACKEND_NAME)
			}
		})
	)

	it.effect("fills voice.languages.list from the voice service", () =>
		Effect.gen(function*() {
			const filled = yield* fillVoiceCommand(
				VoiceLanguagesListCommand.make({
					type: "voice.languages.list",
					commandId,
					languages: emptyVoiceLanguages
				})
			)
			Vitest.assert.strictEqual(filled.type, "voice.languages.list")
			if (filled.type === "voice.languages.list") {
				Vitest.assert.isTrue(filled.languages.length > 0)
				Vitest.assert.strictEqual(filled.languages[0]?.code, "auto")
			}
		})
	)

	it.effect("fills voice.model.status from the voice service", () =>
		Effect.gen(function*() {
			const filled = yield* fillVoiceCommand(
				VoiceModelStatusCommand.make({
					type: "voice.model.status",
					commandId,
					modelId: EXTERNAL_BACKEND_ID,
					model: placeholderVoiceModel(EXTERNAL_BACKEND_ID)
				})
			)
			Vitest.assert.strictEqual(filled.type, "voice.model.status")
			if (filled.type === "voice.model.status") {
				Vitest.assert.strictEqual(filled.model.id, EXTERNAL_BACKEND_ID)
			}
		})
	)

	it.effect("maps voice.model.download failures onto an invariant error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				fillVoiceCommand(
					VoiceModelDownloadCommand.make({
						type: "voice.model.download",
						commandId,
						modelId: EXTERNAL_BACKEND_ID
					})
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "voice.model.download")
		})
	)

	it.effect("runs voice.model.delete against the voice service", () =>
		Effect.gen(function*() {
			const command = VoiceModelDeleteCommand.make({
				type: "voice.model.delete",
				commandId,
				modelId: EXTERNAL_BACKEND_ID
			})
			const filled = yield* fillVoiceCommand(command)
			Vitest.assert.deepStrictEqual(filled, command)
		})
	)

	it.effect("loads a model and fills the status row", () =>
		Effect.gen(function*() {
			const filled = yield* fillVoiceCommand(
				VoiceModelLoadCommand.make({
					type: "voice.model.load",
					commandId,
					modelId: EXTERNAL_BACKEND_ID,
					model: placeholderVoiceModel(EXTERNAL_BACKEND_ID)
				})
			)
			Vitest.assert.strictEqual(filled.type, "voice.model.load")
			if (filled.type === "voice.model.load") {
				Vitest.assert.strictEqual(filled.model.id, EXTERNAL_BACKEND_ID)
				Vitest.assert.strictEqual(filled.model.isDownloaded, false)
				Vitest.assert.strictEqual(filled.model.isLoaded, false)
			}
		})
	)

	it.effect("starts, stops, and cancels recording through the voice service", () =>
		Effect.gen(function*() {
			yield* fillVoiceCommand(
				VoiceRecordingStartCommand.make({
					type: "voice.recording.start",
					commandId: CommandId.make("cmd-start"),
					sessionId
				})
			)
			const stopped = yield* fillVoiceCommand(
				VoiceRecordingStopCommand.make({
					type: "voice.recording.stop",
					commandId: CommandId.make("cmd-stop"),
					sessionId,
					language: null,
					result: emptyVoiceTranscriptionResult
				})
			)
			Vitest.assert.strictEqual(stopped.type, "voice.recording.stop")
			if (stopped.type === "voice.recording.stop") {
				Vitest.assert.strictEqual(stopped.result.text, "")
			}
			const cancelled = yield* fillVoiceCommand(
				VoiceRecordingCancelCommand.make({
					type: "voice.recording.cancel",
					commandId: CommandId.make("cmd-cancel"),
					sessionId
				})
			)
			Vitest.assert.strictEqual(cancelled.type, "voice.recording.cancel")
		})
	)
})

import { APP_VOICE_ID, type OrchestrationEvent, type Sequence } from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import { expect } from "vitest"
import { OrchestrationCommandReceiptsLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts"
import { makeSqliteLayer } from "../../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../../persistence/Migrations.ts"
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { VOICE_PROGRESS_PUBLISH_MS } from "../progress.ts"
import {
	emptyTranscriptionResult,
	VoiceAmplitudeEvent,
	VoiceModelDownloadProgressEvent,
	type VoiceEvent
} from "../Schemas.ts"
import { VoiceService } from "../Services/VoiceService.ts"
import { VoiceProgressBridgeLive } from "./VoiceProgressBridge.ts"

const TempSqlite = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectoryScoped()
		return makeSqliteLayer({ filename: path.join(dir, "voice-progress-test.db"), readonly: false })
	})
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))

const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const notCalled = () => Effect.die("the bridge must not drive the voice service")

/**
 * The bridge only reads `events`, so the rest of the service is a wall: if the
 * bridge ever touched it the test would say so, rather than pass quietly.
 */
const fakeVoiceService = (pubsub: PubSub.PubSub<VoiceEvent>) =>
	Layer.succeed(
		VoiceService,
		VoiceService.of({
			listModels: notCalled,
			listLanguages: notCalled,
			getModelStatus: notCalled,
			downloadModel: notCalled,
			deleteModel: notCalled,
			loadModel: notCalled,
			startRecording: notCalled,
			stopRecording: () => Effect.succeed(emptyTranscriptionResult),
			cancelRecording: notCalled,
			events: Stream.fromPubSub(pubsub)
		})
	)

const readAll = Effect.fn("readAll")(function*() {
	const store = yield* OrchestrationEventStore
	return yield* Stream.runCollect(store.readFrom(0 as Sequence, 1_000))
})

const waitForEvents = Effect.fn("waitForEvents")(function*(
	predicate: (events: ReadonlyArray<OrchestrationEvent>) => boolean,
	attempts = 200
) {
	let seen: ReadonlyArray<OrchestrationEvent> = Arr.empty()
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		seen = yield* readAll()
		if (predicate(seen)) {
			return seen
		}
		yield* Effect.sleep(Duration.millis(25))
	}
	return seen
})

const ofType = (events: ReadonlyArray<OrchestrationEvent>, type: string) =>
	events.filter((event) => event.type === type)

/**
 * `Stream.fromPubSub` only starts holding messages once the bridge's own fiber
 * has subscribed, so the test waits for that before it publishes anything.
 * Without this the first reading is published into an empty room.
 */
const awaitSubscription = Effect.sleep(Duration.millis(200))

const withBridge = <A, E>(
	body: Effect.Effect<A, E, OrchestrationEventStore>,
	pubsub: PubSub.PubSub<VoiceEvent>
) =>
	body.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(VoiceProgressBridgeLive.pipe(Layer.provide(fakeVoiceService(pubsub))))
	)

Vitest.describe("VoiceProgressBridge", () => {
	Vitest.it.live(
		"commits a microphone reading as a VoiceAmplitudeObserved orchestration event",
		() =>
			Effect.gen(function*() {
				const pubsub = yield* PubSub.unbounded<VoiceEvent>()
				yield* withBridge(
					Effect.gen(function*() {
						yield* awaitSubscription
						yield* PubSub.publish(
							pubsub,
							new VoiceAmplitudeEvent({ sessionId: "session-1", values: [0.4, 0.2, 0.3] })
						)
						const events = yield* waitForEvents(
							(seen) => ofType(seen, "VoiceAmplitudeObserved").length > 0
						)
						const observed = ofType(events, "VoiceAmplitudeObserved")
						const first = observed[0]
						expect(first?.aggregateKind).toBe("voice")
						expect(first?.aggregateId).toBe(APP_VOICE_ID)
						expect(first?.payload).toEqual({
							sessionId: "session-1",
							values: [0.4, 0.2, 0.3]
						})
					}),
					pubsub
				)
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(EngineLive),
				Effect.scoped
			)
	)

	Vitest.it.live(
		"sends far fewer events than the capture worker produced readings",
		() =>
			Effect.gen(function*() {
				const pubsub = yield* PubSub.unbounded<VoiceEvent>()
				yield* withBridge(
					Effect.gen(function*() {
						yield* awaitSubscription
						const readings = 40
						for (let index = 0; index < readings; index += 1) {
							yield* PubSub.publish(
								pubsub,
								new VoiceAmplitudeEvent({
									sessionId: "session-1",
									values: [0.1, 0.2, 0.3]
								})
							)
						}
						// One publish window has to pass before anything can arrive.
						yield* Effect.sleep(Duration.millis(VOICE_PROGRESS_PUBLISH_MS * 4))
						const events = yield* waitForEvents(
							(seen) => ofType(seen, "VoiceAmplitudeObserved").length > 0
						)
						const observed = ofType(events, "VoiceAmplitudeObserved")
						expect(observed.length).toBeGreaterThan(0)
						expect(observed.length).toBeLessThan(readings / 4)
					}),
					pubsub
				)
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(EngineLive),
				Effect.scoped
			)
	)

	Vitest.it.live(
		"commits model download progress as a VoiceModelDownloadProgressed orchestration event",
		() =>
			Effect.gen(function*() {
				const pubsub = yield* PubSub.unbounded<VoiceEvent>()
				yield* withBridge(
					Effect.gen(function*() {
						yield* awaitSubscription
						yield* PubSub.publish(
							pubsub,
							new VoiceModelDownloadProgressEvent({
								modelId: "small.en",
								downloadedBytes: 42,
								totalBytes: 100,
								percent: 42
							})
						)
						const events = yield* waitForEvents(
							(seen) => ofType(seen, "VoiceModelDownloadProgressed").length > 0
						)
						const progressed = ofType(events, "VoiceModelDownloadProgressed")
						expect(progressed).toHaveLength(1)
						expect(progressed[0]?.payload).toEqual({
							modelId: "small.en",
							downloadedBytes: 42,
							totalBytes: 100,
							percent: 42
						})
					}),
					pubsub
				)
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(EngineLive),
				Effect.scoped
			)
	)
})

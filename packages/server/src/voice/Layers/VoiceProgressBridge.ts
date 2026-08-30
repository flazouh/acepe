import {
	APP_VOICE_ID,
	CommandId,
	EventId,
	type OrchestrationEvent,
	VoiceAmplitudeObservedEvent,
	VoiceAmplitudeObservedPayload,
	VoiceModelDownloadProgressedEvent,
	VoiceModelDownloadProgressedPayload
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { OrchestrationEngineShape } from "../../orchestration/Services/OrchestrationEngine.ts"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
import {
	collapseVoiceProgressWindow,
	isVoiceProgressEvent,
	VOICE_PROGRESS_PUBLISH_MS,
	VOICE_PROGRESS_WINDOW_LIMIT,
	type VoiceProgressEvent
} from "../progress.ts"
import { VoiceService } from "../Services/VoiceService.ts"

// VoiceService publishes the live microphone level and model download progress
// into its own PubSub. Nothing read that PubSub, so neither fact ever reached
// a person: the dictation meter sat at its resting fill for a whole recording,
// and the download ring showed 0% until the download ended.
//
// This bridge is the reader. It turns those readings into orchestration events
// and commits them through OrchestrationEngine.appendEvents -- the same second
// write path ProviderBridge uses for provider-authored facts, and the same
// single-writer queue commands go through. From there they take the lane every
// other live fact already takes: event store -> streamDomainEvents -> the
// `events` RPC -> the client's fold onto the voice projection. No second
// channel, and no timer polling on the client.
//
// Cadence lives in progress.ts (VOICE_PROGRESS_PUBLISH_MS). Amplitude is the
// high-frequency one, so the bridge holds a window and sends the peak of it
// instead of every reading the capture worker produced.

type BridgeState = {
	readonly engine: OrchestrationEngineShape
	readonly seq: Ref.Ref<number>
}

const decodeAmplitudePayload = Schema.decodeUnknownEffect(VoiceAmplitudeObservedPayload)
const decodeDownloadPayload = Schema.decodeUnknownEffect(VoiceModelDownloadProgressedPayload)

type EventIdentity = {
	readonly eventId: string
	readonly occurredAt: string
}

const nextIdentity = Effect.fn("VoiceProgressBridge.nextIdentity")(function*(state: BridgeState) {
	const occurredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
	const seq = yield* Ref.updateAndGet(state.seq, (current) => current + 1)
	return { eventId: `voice-progress:${String(seq)}`, occurredAt } satisfies EventIdentity
})

const envelope = (identity: EventIdentity) => {
	const commandId = CommandId.make(identity.eventId)
	return {
		// The engine overwrites this with the committed sequence; see
		// OrchestrationEngineShape.appendEvents.
		sequence: 0,
		eventId: EventId.make(identity.eventId),
		aggregateKind: "voice" as const,
		aggregateId: APP_VOICE_ID,
		occurredAt: identity.occurredAt,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {}
	}
}

const toOrchestrationEvent = Effect.fn("VoiceProgressBridge.toOrchestrationEvent")(function*(
	state: BridgeState,
	event: VoiceProgressEvent
) {
	const identity = yield* nextIdentity(state)
	if (event._tag === "VoiceAmplitude") {
		const payload = yield* decodeAmplitudePayload({
			sessionId: event.sessionId,
			values: event.values
		})
		return VoiceAmplitudeObservedEvent.make({
			...envelope(identity),
			type: "VoiceAmplitudeObserved",
			payload
		}) satisfies OrchestrationEvent
	}
	const payload = yield* decodeDownloadPayload({
		modelId: event.modelId,
		downloadedBytes: event.downloadedBytes,
		totalBytes: event.totalBytes,
		percent: event.percent
	})
	return VoiceModelDownloadProgressedEvent.make({
		...envelope(identity),
		type: "VoiceModelDownloadProgressed",
		payload
	}) satisfies OrchestrationEvent
})

export const appendVoiceProgressWindow = Effect.fn("VoiceProgressBridge.appendWindow")(function*(
	state: BridgeState,
	window: ReadonlyArray<VoiceProgressEvent>
) {
	const collapsed = collapseVoiceProgressWindow(window)
	const events = yield* Effect.forEach(collapsed, (event) => toOrchestrationEvent(state, event))
	if (!Arr.isReadonlyArrayNonEmpty(events)) {
		return
	}
	yield* state.engine.appendEvents(events).pipe(Effect.asVoid)
})

export const makeVoiceProgressBridge = Effect.fn("makeVoiceProgressBridge")(function*() {
	const engine = yield* OrchestrationEngine
	const voice = yield* VoiceService
	const layerScope = yield* Effect.scope
	const state: BridgeState = { engine, seq: yield* Ref.make(0) }

	yield* Effect.forkIn(
		voice.events.pipe(
			Stream.filter(isVoiceProgressEvent),
			Stream.groupedWithin(
				VOICE_PROGRESS_WINDOW_LIMIT,
				Duration.millis(VOICE_PROGRESS_PUBLISH_MS)
			),
			Stream.runForEach((window) =>
				appendVoiceProgressWindow(state, window).pipe(
					Effect.catchCause((cause) =>
						Effect.logWarning("voice progress append failed").pipe(
							Effect.annotateLogs({ cause: Cause.pretty(cause) })
						)
					)
				)
			)
		),
		layerScope,
		{ startImmediately: true }
	)
})

export const VoiceProgressBridgeLive = Layer.effectDiscard(makeVoiceProgressBridge())

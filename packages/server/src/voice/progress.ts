import type { VoiceAmplitudeValues } from "@acepe/contracts"
import { VoiceAmplitudeEvent, VoiceModelDownloadProgressEvent, type VoiceEvent } from "./Schemas.ts"

/**
 * How often voice progress leaves this process, in milliseconds.
 *
 * The capture worker reads the microphone every `WORKER_TICK_MS` (50 ms), so
 * the raw rate is 20 readings a second. Every reading that leaves the process
 * costs an event store row and an RPC frame, and a person cannot read a 13 bar
 * meter faster than about ten times a second. So the bridge holds a window of
 * this length, keeps the loudest reading in it, and sends that one. 100 ms is
 * also the integration window a hardware VU meter uses, which is why the
 * result still looks alive at a fifth of the traffic.
 *
 * Downsample here, at the producer. A component that throttles what it draws
 * has already paid for every frame it throws away.
 */
export const VOICE_PROGRESS_PUBLISH_MS = 100

/**
 * Upper bound on how many readings one window may hold before it is sent
 * early. At the capture rate a 100 ms window holds two, so this only ever
 * fires if some future capture backend runs far faster; it caps memory, it
 * does not set the cadence.
 */
export const VOICE_PROGRESS_WINDOW_LIMIT = 512

export type VoiceProgressEvent = VoiceAmplitudeEvent | VoiceModelDownloadProgressEvent

export const isVoiceProgressEvent = (event: VoiceEvent): event is VoiceProgressEvent =>
	event._tag === "VoiceAmplitude" || event._tag === "VoiceModelDownloadProgress"

/**
 * Peak hold: the loudest of two readings, slot by slot. Keeping the peak
 * rather than the last reading is what stops a downsampled meter from missing
 * a short sound that happened to land between two windows.
 */
export const peakHold = (
	left: VoiceAmplitudeValues,
	right: VoiceAmplitudeValues
): VoiceAmplitudeValues => [
	Math.max(left[0], right[0]),
	Math.max(left[1], right[1]),
	Math.max(left[2], right[2])
]

const amplitudeKey = (event: VoiceAmplitudeEvent): string => `amplitude:${event.sessionId}`
const downloadKey = (event: VoiceModelDownloadProgressEvent): string => `download:${event.modelId}`

const mergeInto = (
	held: VoiceProgressEvent,
	next: VoiceProgressEvent
): VoiceProgressEvent => {
	if (held._tag === "VoiceAmplitude" && next._tag === "VoiceAmplitude") {
		return new VoiceAmplitudeEvent({
			sessionId: next.sessionId,
			values: peakHold(held.values, next.values)
		})
	}
	// A download reports where it has come to, so the newest reading already
	// says everything the older ones did.
	return next
}

/**
 * Collapse one window of progress readings into what the client actually
 * needs: the peak level per recording, and the latest progress per download.
 * First-seen order is kept so the client applies them the way they happened.
 */
export const collapseVoiceProgressWindow = (
	window: ReadonlyArray<VoiceProgressEvent>
): ReadonlyArray<VoiceProgressEvent> => {
	const order: Array<string> = []
	const held = new Map<string, VoiceProgressEvent>()
	for (const event of window) {
		const key = event._tag === "VoiceAmplitude" ? amplitudeKey(event) : downloadKey(event)
		const current = held.get(key)
		if (current === undefined) {
			order.push(key)
			held.set(key, event)
			continue
		}
		held.set(key, mergeInto(current, event))
	}
	const collapsed: Array<VoiceProgressEvent> = []
	for (const key of order) {
		const event = held.get(key)
		if (event !== undefined) {
			collapsed.push(event)
		}
	}
	return collapsed
}

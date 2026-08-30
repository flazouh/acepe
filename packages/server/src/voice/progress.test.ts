import { describe, expect, it } from "vitest"
import {
	collapseVoiceProgressWindow,
	isVoiceProgressEvent,
	peakHold,
	VOICE_PROGRESS_PUBLISH_MS,
	type VoiceProgressEvent
} from "./progress.ts"
import {
	VoiceAmplitudeEvent,
	VoiceModelDownloadProgressEvent,
	VoiceRecordingErrorEvent,
	WORKER_TICK_MS
} from "./Schemas.ts"

const amplitude = (sessionId: string, values: [number, number, number]): VoiceAmplitudeEvent =>
	new VoiceAmplitudeEvent({ sessionId, values })

const download = (modelId: string, percent: number): VoiceModelDownloadProgressEvent =>
	new VoiceModelDownloadProgressEvent({
		modelId,
		downloadedBytes: Math.round(percent),
		totalBytes: 100,
		percent
	})

describe("voice progress cadence", () => {
	it("sends less often than the capture worker reads the microphone", () => {
		expect(VOICE_PROGRESS_PUBLISH_MS).toBeGreaterThan(WORKER_TICK_MS)
	})
})

describe("peakHold", () => {
	it("keeps the louder reading in every slot", () => {
		expect(peakHold([0.1, 0.9, 0.2], [0.4, 0.3, 0.2])).toEqual([0.4, 0.9, 0.2])
	})
})

describe("isVoiceProgressEvent", () => {
	it("takes amplitude and download progress and leaves the rest", () => {
		expect(isVoiceProgressEvent(amplitude("session-1", [0.1, 0.1, 0.1]))).toBe(true)
		expect(isVoiceProgressEvent(download("small.en", 12))).toBe(true)
		expect(
			isVoiceProgressEvent(new VoiceRecordingErrorEvent({ sessionId: "session-1", message: "x" }))
		).toBe(false)
	})
})

describe("collapseVoiceProgressWindow", () => {
	it("collapses a window of readings to one peak per recording", () => {
		const collapsed = collapseVoiceProgressWindow([
			amplitude("session-1", [0.1, 0.2, 0.3]),
			amplitude("session-1", [0.4, 0.1, 0.2])
		])
		expect(collapsed).toHaveLength(1)
		const first = collapsed[0] as VoiceAmplitudeEvent
		expect(first._tag).toBe("VoiceAmplitude")
		expect(first.values).toEqual([0.4, 0.2, 0.3])
	})

	it("keeps one peak per recording session", () => {
		const collapsed = collapseVoiceProgressWindow([
			amplitude("session-1", [0.1, 0.1, 0.1]),
			amplitude("session-2", [0.5, 0.5, 0.5]),
			amplitude("session-1", [0.2, 0.2, 0.2])
		])
		expect(collapsed).toHaveLength(2)
		expect((collapsed[0] as VoiceAmplitudeEvent).sessionId).toBe("session-1")
		expect((collapsed[0] as VoiceAmplitudeEvent).values).toEqual([0.2, 0.2, 0.2])
		expect((collapsed[1] as VoiceAmplitudeEvent).sessionId).toBe("session-2")
	})

	it("keeps only the latest progress for a download", () => {
		const collapsed = collapseVoiceProgressWindow([download("small.en", 10), download("small.en", 40)])
		expect(collapsed).toHaveLength(1)
		expect((collapsed[0] as VoiceModelDownloadProgressEvent).percent).toBe(40)
	})

	it("keeps a recording and a download apart", () => {
		const window: ReadonlyArray<VoiceProgressEvent> = [
			amplitude("session-1", [0.1, 0.1, 0.1]),
			download("small.en", 10)
		]
		expect(collapseVoiceProgressWindow(window)).toHaveLength(2)
	})

	it("answers an empty window with nothing", () => {
		expect(collapseVoiceProgressWindow([])).toEqual([])
	})
})

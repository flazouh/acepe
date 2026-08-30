import {
	APP_VOICE_ID,
	CommandId,
	EventId,
	type OrchestrationEvent,
	type RpcClient,
	SessionId,
	TrimmedNonEmptyString,
	type VoiceAmplitude,
	type VoiceModelDownload,
} from "@acepe/contracts";
import { describe, expect, it } from "vitest";

import { composeVoiceProgressStore } from "./voice-progress-store.ts";

const occurredAt = "2026-01-01T00:00:00.000Z";
const sessionId = SessionId.make("session-1");

/**
 * The store only reads events through `applyEvent` in these tests, so the
 * client is never called. It exists because the store also knows how to open
 * the stream, and that path has its own coverage in the app.
 */
const stubClient = {} as unknown as RpcClient;

const voiceEvent = (
	sequence: number,
	type: OrchestrationEvent["type"],
	payload: OrchestrationEvent["payload"]
): OrchestrationEvent => {
	const commandId = CommandId.make(`command-${String(sequence)}`);
	return {
		sequence,
		eventId: EventId.make(`event-${String(sequence)}`),
		aggregateKind: "voice",
		aggregateId: APP_VOICE_ID,
		occurredAt,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type,
		payload,
	} as OrchestrationEvent;
};

const amplitudeObserved = (sequence: number, values: [number, number, number]) =>
	voiceEvent(sequence, "VoiceAmplitudeObserved", { sessionId, values });

const recordingStopped = (sequence: number) =>
	voiceEvent(sequence, "VoiceRecordingStopped", {
		sessionId,
		language: null,
		result: { text: "", language: null, durationMs: 0 },
	});

const downloadProgressed = (sequence: number, percent: number) =>
	voiceEvent(sequence, "VoiceModelDownloadProgressed", {
		modelId: TrimmedNonEmptyString.make("small.en"),
		downloadedBytes: percent,
		totalBytes: 100,
		percent,
	});

const downloaded = (sequence: number) =>
	voiceEvent(sequence, "VoiceModelDownloaded", {
		modelId: TrimmedNonEmptyString.make("small.en"),
	});

const collect = () => {
	const amplitudes: Array<VoiceAmplitude | null> = [];
	const downloads: Array<VoiceModelDownload | null> = [];
	const store = composeVoiceProgressStore({ client: stubClient });
	store.subscribe({
		onAmplitude: (amplitude) => amplitudes.push(amplitude),
		onDownload: (download) => downloads.push(download),
	});
	return { store, amplitudes, downloads };
};

describe("composeVoiceProgressStore", () => {
	it("carries every microphone reading to its listener", () => {
		const { store, amplitudes } = collect();

		store.applyEvent(amplitudeObserved(1, [0.1, 0.2, 0.3]));
		store.applyEvent(amplitudeObserved(2, [0.4, 0.5, 0.6]));

		expect(amplitudes).toEqual([
			{ sessionId, values: [0.1, 0.2, 0.3] },
			{ sessionId, values: [0.4, 0.5, 0.6] },
		]);
	});

	it("reports silence when the recording ends", () => {
		const { store, amplitudes } = collect();

		store.applyEvent(amplitudeObserved(1, [0.4, 0.5, 0.6]));
		store.applyEvent(recordingStopped(2));

		expect(amplitudes.at(-1)).toBeNull();
		expect(store.readSnapshot().voice?.amplitude).toBeNull();
	});

	it("carries download progress to its listener and clears it on completion", () => {
		const { store, downloads } = collect();

		store.applyEvent(downloadProgressed(1, 37));
		expect(downloads.at(-1)).toEqual({
			modelId: "small.en",
			downloadedBytes: 37,
			totalBytes: 100,
			percent: 37,
		});

		store.applyEvent(downloaded(2));
		expect(downloads.at(-1)).toBeNull();
	});

	it("ignores events that say nothing about voice progress", () => {
		const { store, amplitudes, downloads } = collect();

		store.applyEvent(voiceEvent(1, "VoiceModelsListed", { models: [] }));

		expect(amplitudes).toEqual([]);
		expect(downloads).toEqual([]);
	});

	it("stops calling a listener that unsubscribed", () => {
		const seen: Array<VoiceAmplitude | null> = [];
		const store = composeVoiceProgressStore({ client: stubClient });
		const unsubscribe = store.subscribe({
			onAmplitude: (amplitude) => seen.push(amplitude),
		});

		store.applyEvent(amplitudeObserved(1, [0.1, 0.1, 0.1]));
		unsubscribe();
		store.applyEvent(amplitudeObserved(2, [0.9, 0.9, 0.9]));

		expect(seen).toHaveLength(1);
	});
});

import {
	applyEventToRpcSessionSnapshot,
	emptyRpcSessionSnapshot,
	type OrchestrationEvent,
	type RpcClient,
	type RpcSessionSnapshot,
	type VoiceAmplitude,
	type VoiceModelDownload,
	voiceSnapshotRequest,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Stream from "effect/Stream";

/**
 * The live microphone level and model download progress reach the client the
 * way every other live fact does: the `events` RPC, folded onto the voice
 * projection. The server side of the lane is
 * packages/server/src/voice/Layers/VoiceProgressBridge.ts.
 *
 * This store reads the folded projection, never the raw event payload. The
 * event says only that the projection moved; the projection says what is
 * true. That is also why the recording events are in the list: they are what
 * clears the level back to silence.
 */
const AMPLITUDE_EVENT_TYPES = HashSet.fromIterable([
	"VoiceAmplitudeObserved",
	"VoiceRecordingStarted",
	"VoiceRecordingStopped",
	"VoiceRecordingCancelled",
]);

const DOWNLOAD_EVENT_TYPES = HashSet.fromIterable([
	"VoiceModelDownloadProgressed",
	"VoiceModelDownloaded",
]);

export const isVoiceAmplitudeEvent = (event: OrchestrationEvent): boolean =>
	HashSet.has(AMPLITUDE_EVENT_TYPES, event.type);

export const isVoiceDownloadEvent = (event: OrchestrationEvent): boolean =>
	HashSet.has(DOWNLOAD_EVENT_TYPES, event.type);

export const isVoiceProgressEvent = (event: OrchestrationEvent): boolean =>
	isVoiceAmplitudeEvent(event) || isVoiceDownloadEvent(event);

export type VoiceProgressListener = {
	/** Null means silence: no recording, or one that just ended. */
	readonly onAmplitude?: (amplitude: VoiceAmplitude | null) => void;
	/** Null means no download is running. */
	readonly onDownload?: (download: VoiceModelDownload | null) => void;
};

export const composeVoiceProgressStore = (input: { readonly client: RpcClient }) => {
	let snapshot: RpcSessionSnapshot = emptyRpcSessionSnapshot(0);
	const listeners = new Set<VoiceProgressListener>();

	const readSnapshot = (): RpcSessionSnapshot => snapshot;

	const notifyAmplitude = (amplitude: VoiceAmplitude | null): void => {
		for (const listener of listeners) {
			listener.onAmplitude?.(amplitude);
		}
	};

	const notifyDownload = (download: VoiceModelDownload | null): void => {
		for (const listener of listeners) {
			listener.onDownload?.(download);
		}
	};

	const applyEvent = (event: OrchestrationEvent): void => {
		if (isVoiceProgressEvent(event) === false) {
			return;
		}
		snapshot = applyEventToRpcSessionSnapshot(snapshot, event);
		const voice = snapshot.voice;
		if (voice === null) {
			return;
		}
		if (isVoiceAmplitudeEvent(event)) {
			notifyAmplitude(voice.amplitude);
		}
		if (isVoiceDownloadEvent(event)) {
			notifyDownload(voice.download);
		}
	};

	const subscribe = (listener: VoiceProgressListener): (() => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};

	const open = Effect.fn("openVoiceProgress")(function* () {
		const snap = yield* input.client.snapshot(voiceSnapshotRequest());
		snapshot = snap;
		yield* input.client.events(snap.snapshotSequence).pipe(
			Stream.runForEach((event) => {
				applyEvent(event);
				return Effect.void;
			})
		);
	});

	return { open, applyEvent, subscribe, readSnapshot };
};

export type VoiceProgressStore = ReturnType<typeof composeVoiceProgressStore>;

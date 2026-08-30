import { mock } from "bun:test";
import { SessionId } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceProgressListener } from "$lib/stores/voice-progress-store.ts";

/**
 * Proves the two live voice facts land where a person sees them: the
 * microphone level in the waveform meter, and download progress in the mic
 * button's ring. Both used to stop at the server: nothing read the lane they
 * are published on.
 */
const getModelStatusMock = vi.fn();
const downloadModelMock = vi.fn();
const loadModelMock = vi.fn();
const startRecordingMock = vi.fn();
const stopRecordingMock = vi.fn();
const cancelRecordingMock = vi.fn();

let VoiceInputState: typeof import("../voice-input-state.svelte.js").VoiceInputState;
let listeners: Array<VoiceProgressListener> = [];

const toAgentResult = <T>(operation: string, result: Effect.Effect<T, Error>) =>
	result.pipe(
		Effect.mapError((cause) => {
			const wrapped = new Error(`Agent operation failed: ${operation}`);
			(wrapped as Error & { cause?: Error }).cause = cause;
			return wrapped;
		})
	);

/** A promise the test opens when it wants the pending call to finish. */
const createGate = () => {
	let open: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open: () => open() };
};

const flushAsync = async (times = 20): Promise<void> => {
	for (let index = 0; index < times; index += 1) {
		await Promise.resolve();
	}
};

const pointerEvent = (): PointerEvent =>
	({
		pointerId: 1,
		currentTarget: { setPointerCapture() {} },
	}) as unknown as PointerEvent;

const pushAmplitude = (values: [number, number, number]): void => {
	for (const listener of listeners) {
		listener.onAmplitude?.({ sessionId: SessionId.make("session-1"), values });
	}
};

const pushSilence = (): void => {
	for (const listener of listeners) {
		listener.onAmplitude?.(null);
	}
};

const pushDownload = (percent: number): void => {
	for (const listener of listeners) {
		listener.onDownload?.({
			modelId: "small.en",
			downloadedBytes: percent,
			totalBytes: 100,
			percent,
		});
	}
};

describe("voice progress reaches the composer", () => {
	beforeEach(async () => {
		listeners = [];
		getModelStatusMock.mockReset();
		downloadModelMock.mockReset();
		loadModelMock.mockReset();
		startRecordingMock.mockReset();
		stopRecordingMock.mockReset();
		cancelRecordingMock.mockReset();

		mock.module("svelte-sonner", () => ({
			toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
		}));
		mock.module("$lib/acp/types/sounds.js", () => ({
			SoundEffect: { SoundUp: "sound-up", SoundDown: "sound-down" },
		}));
		mock.module("$lib/acp/utils/sound.js", () => ({ playSound: vi.fn() }));
		mock.module("$lib/stores/voice-progress.ts", () => ({
			subscribeVoiceProgress: (listener: VoiceProgressListener) => {
				listeners.push(listener);
				return () => {
					listeners = listeners.filter((entry) => entry !== listener);
				};
			},
			resetVoiceProgressForTests: () => {
				listeners = [];
			},
		}));

		const backendClientMock = {
			openFileInEditor: mock(() => undefined),
			revealInFinder: mock(() => undefined),
			backendClient: {
				voice: {
					cancelRecording: (sessionId: string) =>
						toAgentResult("voice_cancel_recording", cancelRecordingMock(sessionId)),
					getModelStatus: (modelId: string) =>
						toAgentResult("voice_get_model_status", getModelStatusMock(modelId)),
					startRecording: (sessionId: string) =>
						toAgentResult("voice_start_recording", startRecordingMock(sessionId)),
					loadModel: (modelId: string) => toAgentResult("voice_load_model", loadModelMock(modelId)),
					downloadModel: (modelId: string) =>
						toAgentResult("voice_download_model", downloadModelMock(modelId)),
					stopRecording: (sessionId: string, language: string | null) =>
						toAgentResult("voice_stop_recording", stopRecordingMock(sessionId, language)),
				},
			},
		};
		for (const specifier of [
			"$lib/utils/backend-client.js",
			"../../../../utils/backend-client.js",
			`${import.meta.dir}/../../../../../utils/backend-client.ts`,
			`${import.meta.dir}/../../../../../utils/backend-client.js`,
			`${import.meta.dir}/../../../../../utils/backend-client/index.ts`,
			`${import.meta.dir}/../../../../../utils/backend-client/index.js`,
		]) {
			mock.module(specifier, () => backendClientMock);
		}

		(globalThis as { window?: unknown }).window = {};

		({ VoiceInputState } = await import("../voice-input-state.svelte.js"));

		cancelRecordingMock.mockReturnValue(Effect.succeed(undefined));
		startRecordingMock.mockReturnValue(Effect.succeed(undefined));
		loadModelMock.mockReturnValue(Effect.succeed(undefined));
		stopRecordingMock.mockReturnValue(Effect.succeed({ text: "", language: null, duration_ms: 0 }));
	});

	it("moves the meter when the microphone level arrives", async () => {
		const state = new VoiceInputState({ sessionId: "session-1" });
		await state.registerListeners();

		const resting = [...state.waveform.meterLevels];
		expect(resting.every((level) => level === 0)).toBe(true);

		pushAmplitude([0.6, 0.6, 0.6]);
		const loud = [...state.waveform.meterLevels];

		expect(state.waveform.currentLevel).toBeGreaterThan(0);
		expect(loud).not.toEqual(resting);
		expect(loud.some((level) => level > 0)).toBe(true);
	});

	it("keeps the meter alive across a run of readings", async () => {
		const state = new VoiceInputState({ sessionId: "session-1" });
		await state.registerListeners();

		const samples: Array<number> = [];
		for (const value of [0.05, 0.4, 0.9, 0.2, 0.7]) {
			pushAmplitude([value, value, value]);
			samples.push(state.waveform.currentLevel);
		}

		expect(new Set(samples).size).toBeGreaterThan(1);
	});

	it("ignores a reading from another recording session", async () => {
		const state = new VoiceInputState({ sessionId: "session-1" });
		await state.registerListeners();

		for (const listener of listeners) {
			listener.onAmplitude?.({
				sessionId: SessionId.make("session-other"),
				values: [0.9, 0.9, 0.9],
			});
		}

		expect(state.waveform.currentLevel).toBe(0);
	});

	it("returns the meter to silence when the recording ends", async () => {
		const state = new VoiceInputState({ sessionId: "session-1" });
		await state.registerListeners();

		pushAmplitude([0.9, 0.9, 0.9]);
		expect(state.waveform.currentLevel).toBeGreaterThan(0);

		pushSilence();
		expect(state.waveform.currentLevel).toBe(0);
		expect(state.waveform.meterLevels.every((level) => level === 0)).toBe(true);
	});

	it("moves the download ring while the model downloads", async () => {
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: false, is_loaded: false }));
		const download = createGate();
		downloadModelMock.mockReturnValue(Effect.promise(() => download.promise));

		const state = new VoiceInputState({ sessionId: "session-1" });
		await state.registerListeners();
		state.onMicPointerDown(pointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("downloading_model");
		expect(state.downloadPercent).toBe(0);

		pushDownload(37);
		expect(state.downloadPercent).toBe(37);

		pushDownload(84);
		expect(state.downloadPercent).toBe(84);

		download.open();
		await flushAsync();
		expect(state.downloadPercent).toBe(100);
	});
});

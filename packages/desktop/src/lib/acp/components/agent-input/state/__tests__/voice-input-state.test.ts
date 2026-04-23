import { mock } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.fn();
const cancelRecordingMock = vi.fn();
const getModelStatusMock = vi.fn();
const startRecordingMock = vi.fn();
const loadModelMock = vi.fn();
const downloadModelMock = vi.fn();
const stopRecordingMock = vi.fn();
const toastInfoMock = vi.fn();
const playSoundMock = vi.fn();

type TauriWindow = typeof globalThis & {
	window: Window & {
		__TAURI_INTERNALS__: {
			invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
		};
	};
};

let VoiceInputState: typeof import("../voice-input-state.svelte.js").VoiceInputState;

function createPendingResult<T>() {
	let resolveValue: ((value: T) => void) | null = null;
	let rejectValue: ((error: Error) => void) | null = null;
	const promise = new Promise<T>((resolve, reject) => {
		resolveValue = resolve;
		rejectValue = reject;
	});

	return {
		promise,
		resolve(value: T) {
			if (resolveValue) {
				resolveValue(value);
			}
		},
		reject(error: Error) {
			if (rejectValue) {
				rejectValue(error);
			}
		},
	};
}

function createPointerEvent(): PointerEvent {
	return {
		pointerId: 1,
		currentTarget: {
			setPointerCapture() {},
		},
	} as unknown as PointerEvent;
}

function unwrapResultAsync<T>(result: ResultAsync<T, Error>): Promise<T> {
	return result.match(
		(value) => value,
		(error) => {
			throw error;
		}
	);
}

function toAgentResult<T>(operation: string, result: ResultAsync<T, Error>): ResultAsync<T, Error> {
	return result.mapErr(() => new Error(`Agent operation failed: ${operation}`));
}

async function flushAsync(times = 20): Promise<void> {
	for (let index = 0; index < times; index += 1) {
		await Promise.resolve();
	}
}

function installTimerHarness() {
	const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
	const originalClearTimeout = globalThis.clearTimeout.bind(globalThis);
	const originalSetInterval = globalThis.setInterval.bind(globalThis);
	const originalClearInterval = globalThis.clearInterval.bind(globalThis);
	const timeouts = new Map<Parameters<typeof clearTimeout>[0], () => void>();
	const intervals = new Map<Parameters<typeof clearInterval>[0], () => void>();

	vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
		if (typeof handler !== "function") {
			throw new Error("voice-input-state test timer harness expects function timeouts");
		}

		const timerId = originalSetTimeout(() => undefined, 0);
		originalClearTimeout(timerId);
		timeouts.set(timerId, handler);
		return timerId;
	});

	vi.spyOn(globalThis, "clearTimeout").mockImplementation((timerId) => {
		timeouts.delete(timerId);
	});

	vi.spyOn(globalThis, "setInterval").mockImplementation((handler) => {
		if (typeof handler !== "function") {
			throw new Error("voice-input-state test timer harness expects function intervals");
		}

		const timerId = originalSetInterval(() => undefined, 60_000);
		originalClearInterval(timerId);
		intervals.set(timerId, handler);
		return timerId;
	});

	vi.spyOn(globalThis, "clearInterval").mockImplementation((timerId) => {
		intervals.delete(timerId);
	});

	return {
		runPendingTimeouts(): void {
			const pending = [...timeouts.values()];
			timeouts.clear();
			for (const callback of pending) {
				callback();
			}
		},
		tickIntervals(times = 1): void {
			for (let index = 0; index < times; index += 1) {
				for (const callback of [...intervals.values()]) {
					callback();
				}
			}
		},
	};
}

describe("VoiceInputState", () => {
	beforeEach(async () => {
		listenMock.mockReset();
		cancelRecordingMock.mockReset();
		getModelStatusMock.mockReset();
		startRecordingMock.mockReset();
		loadModelMock.mockReset();
		downloadModelMock.mockReset();
		stopRecordingMock.mockReset();
		toastInfoMock.mockReset();
		playSoundMock.mockReset();

		mock.module("@tauri-apps/api/event", () => ({
			listen: listenMock,
			once: listenMock,
			emit: vi.fn(),
			emitTo: vi.fn(),
			TauriEvent: {},
		}));
		mock.module("svelte-sonner", () => ({
			toast: {
				error: vi.fn(),
				info: toastInfoMock,
				success: vi.fn(),
			},
		}));
		mock.module("$lib/acp/types/sounds.js", () => ({
			SoundEffect: {
				SoundUp: "sound-up",
				SoundDown: "sound-down",
			},
		}));
		mock.module("runed", () => ({}));
		mock.module("$lib/acp/utils/sound.js", () => ({
			playSound: playSoundMock,
		}));
		mock.module("$lib/utils/tauri-client.js", () => ({
			openFileInEditor: mock(() => undefined),
			revealInFinder: mock(() => undefined),
			tauriClient: {
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
		}));

		const invokeMock = vi.fn((cmd: string, args?: Record<string, unknown>) => {
			switch (cmd) {
				case "voice_cancel_recording":
					return unwrapResultAsync(cancelRecordingMock(args?.sessionId));
				case "voice_get_model_status":
					return unwrapResultAsync(getModelStatusMock(args?.modelId));
				case "voice_start_recording":
					return unwrapResultAsync(startRecordingMock(args?.sessionId));
				case "voice_load_model":
					return unwrapResultAsync(loadModelMock(args?.modelId));
				case "voice_download_model":
					return unwrapResultAsync(downloadModelMock(args?.modelId));
				case "voice_stop_recording":
					return unwrapResultAsync(stopRecordingMock(args?.sessionId, args?.language ?? null));
				default:
					throw new Error(`Unexpected Tauri command: ${cmd}`);
			}
		});

		(globalThis as TauriWindow).window = {
			__TAURI_INTERNALS__: {
				invoke: invokeMock,
			},
		} as unknown as TauriWindow["window"];

		({ VoiceInputState } = await import("../voice-input-state.svelte.js"));

		listenMock.mockResolvedValue(() => undefined);
		cancelRecordingMock.mockReturnValue(okAsync(undefined));
		startRecordingMock.mockReturnValue(okAsync(undefined));
		loadModelMock.mockReturnValue(okAsync(undefined));
		downloadModelMock.mockReturnValue(okAsync(undefined));
		stopRecordingMock.mockReturnValue(okAsync(undefined));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("enters recording immediately when model is already loaded", async () => {
		getModelStatusMock.mockReturnValue(okAsync({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-1" });
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("recording");
	});

	it("stops recording on pointer up while already recording", async () => {
		const state = new VoiceInputState({ sessionId: "session-2" });
		state.phase = "recording";

		state.onMicPointerUp();
		await Promise.resolve();

		expect(stopRecordingMock).toHaveBeenCalledWith("session-2", null);
		expect(state.phase).toBe("transcribing");
	});

	it("handles transcription completion before stopRecording resolves", async () => {
		const pendingStop = createPendingResult<void>();
		stopRecordingMock.mockReturnValue(
			ResultAsync.fromPromise(pendingStop.promise, (error) => error as Error)
		);

		const state = new VoiceInputState({ sessionId: "session-race" });
		await state.registerListeners();
		state.phase = "recording";

		state.stopRecording();
		expect(state.phase).toBe("transcribing");

		const transcriptionListener = listenMock.mock.calls.find(
			([eventName]) => eventName === "voice://transcription_complete"
		)?.[1] as
			| ((event: {
					payload: {
						session_id: string;
						text: string;
						language: string | null;
						duration_ms: number;
					};
			  }) => void)
			| undefined;

		if (!transcriptionListener) {
			throw new Error("expected transcription_complete listener");
		}

		transcriptionListener({
			payload: {
				session_id: "session-race",
				text: "hello world",
				language: null,
				duration_ms: 1000,
			},
		});

		expect(toastInfoMock).not.toHaveBeenCalled();
		expect(state.phase).toBe("idle");

		pendingStop.resolve(undefined);
		await Promise.resolve();
	});

	it("ignores late stopRecording failures after transcription already completed", async () => {
		const pendingStop = createPendingResult<void>();
		stopRecordingMock.mockReturnValue(
			ResultAsync.fromPromise(pendingStop.promise, (error) => error as Error)
		);

		const state = new VoiceInputState({ sessionId: "session-late-stop-error" });
		await state.registerListeners();
		state.phase = "recording";

		state.stopRecording();
		expect(state.phase).toBe("transcribing");

		const transcriptionListener = listenMock.mock.calls.find(
			([eventName]) => eventName === "voice://transcription_complete"
		)?.[1] as
			| ((event: {
					payload: {
						session_id: string;
						text: string;
						language: string | null;
						duration_ms: number;
					};
			  }) => void)
			| undefined;

		if (!transcriptionListener) {
			throw new Error("expected transcription_complete listener");
		}

		transcriptionListener({
			payload: {
				session_id: "session-late-stop-error",
				text: "hello world",
				language: null,
				duration_ms: 1000,
			},
		});

		expect(state.phase).toBe("idle");
		expect(state.errorMessage).toBeNull();

		pendingStop.reject(new Error("Agent operation failed: voice_stop_recording"));
		await flushAsync();

		expect(state.phase).toBe("idle");
		expect(state.errorMessage).toBeNull();
	});

	it("does not allow cancelling while transcribing", async () => {
		const state = new VoiceInputState({ sessionId: "session-transcribing" });
		state.phase = "transcribing";

		state.cancelRecording();
		await Promise.resolve();

		expect(cancelRecordingMock).not.toHaveBeenCalled();
		expect(state.phase).toBe("transcribing");
	});

	it("shows no speech toast and returns to idle on empty transcription", async () => {
		const state = new VoiceInputState({ sessionId: "session-3" });
		await state.registerListeners();

		const transcriptionListener = listenMock.mock.calls.find(
			([eventName]) => eventName === "voice://transcription_complete"
		)?.[1] as
			| ((event: {
					payload: {
						session_id: string;
						text: string;
						language: string | null;
						duration_ms: number;
					};
			  }) => void)
			| undefined;

		if (!transcriptionListener) {
			throw new Error("expected transcription_complete listener");
		}

		state.phase = "transcribing";
		transcriptionListener({
			payload: {
				session_id: "session-3",
				text: "   ",
				language: null,
				duration_ms: 1000,
			},
		});

		expect(toastInfoMock).toHaveBeenCalledTimes(1);
		expect(state.phase).toBe("idle");
	});

	it("surfaces model status failures", async () => {
		getModelStatusMock.mockReturnValue(errAsync(new Error("status failed")));

		const state = new VoiceInputState({ sessionId: "session-4" });
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(state.errorMessage).toBe("Agent operation failed: voice_get_model_status");
	});

	it("starts recording immediately for keyboard press-and-hold", async () => {
		getModelStatusMock.mockReturnValue(okAsync({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-keyboard" });

		state.onKeyboardHoldStart();
		await flushAsync();

		expect(playSoundMock).toHaveBeenCalledTimes(1);
		expect(state.phase).toBe("recording");

		state.onKeyboardHoldEnd();
		await Promise.resolve();

		expect(playSoundMock).toHaveBeenCalledTimes(2);
		expect(stopRecordingMock).toHaveBeenCalledWith("session-keyboard", null);
		expect(state.phase).toBe("transcribing");
	});

	it("cancels keyboard press-and-hold if released during startup", async () => {
		const pendingModelStatus = createPendingResult<{
			is_downloaded: boolean;
			is_loaded: boolean;
		}>();
		getModelStatusMock.mockReturnValue(
			ResultAsync.fromPromise(pendingModelStatus.promise, (error) => error as Error)
		);

		const state = new VoiceInputState({ sessionId: "session-keyboard-startup" });

		state.onKeyboardHoldStart();
		await flushAsync();

		expect(state.phase).toBe("checking_permission");

		state.onKeyboardHoldEnd();
		await flushAsync();

		expect(cancelRecordingMock).toHaveBeenCalledWith("session-keyboard-startup");
		expect(state.phase).toBe("idle");

		pendingModelStatus.resolve({ is_downloaded: true, is_loaded: true });
		await flushAsync();

		expect(startRecordingMock).not.toHaveBeenCalled();
	});

	it("cancels pointer press-and-hold if released during startup", async () => {
		const timers = installTimerHarness();
		const pendingModelStatus = createPendingResult<{
			is_downloaded: boolean;
			is_loaded: boolean;
		}>();
		getModelStatusMock.mockReturnValue(
			ResultAsync.fromPromise(pendingModelStatus.promise, (error) => error as Error)
		);

		const state = new VoiceInputState({ sessionId: "session-pointer-startup" });

		state.onMicPointerDown(createPointerEvent());
		timers.runPendingTimeouts();
		await flushAsync();

		expect(state.phase).toBe("checking_permission");

		state.onMicPointerUp();
		await flushAsync();

		expect(cancelRecordingMock).toHaveBeenCalledWith("session-pointer-startup");
		expect(state.phase).toBe("idle");

		pendingModelStatus.resolve({ is_downloaded: true, is_loaded: true });
		await flushAsync();

		expect(startRecordingMock).not.toHaveBeenCalled();
	});

	it("cancels click-to-toggle startup on a second click before recording begins", async () => {
		const pendingModelStatus = createPendingResult<{
			is_downloaded: boolean;
			is_loaded: boolean;
		}>();
		getModelStatusMock.mockReturnValue(
			ResultAsync.fromPromise(pendingModelStatus.promise, (error) => error as Error)
		);

		const state = new VoiceInputState({ sessionId: "session-click-startup" });

		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("checking_permission");

		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(cancelRecordingMock).toHaveBeenCalledWith("session-click-startup");
		expect(state.phase).toBe("idle");

		pendingModelStatus.resolve({ is_downloaded: true, is_loaded: true });
		await flushAsync();

		expect(startRecordingMock).not.toHaveBeenCalled();
	});

	it("keeps the waveform quiet before the first live amplitude event arrives", async () => {
		const pendingModelStatus = createPendingResult<{
			is_downloaded: boolean;
			is_loaded: boolean;
		}>();
		getModelStatusMock.mockReturnValue(
			ResultAsync.fromPromise(pendingModelStatus.promise, (error) => error as Error)
		);

		const state = new VoiceInputState({ sessionId: "session-waveform-prime" });

		state.onKeyboardHoldStart();
		await flushAsync();

		expect(state.phase).toBe("checking_permission");
		expect(state.waveform.meterLevels.every((level) => level === 0)).toBe(true);

		pendingModelStatus.resolve({ is_downloaded: true, is_loaded: true });
		await flushAsync();
	});

	it("plays the start sound before voice startup work begins for keyboard hold", () => {
		getModelStatusMock.mockReturnValue(okAsync({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-sound-order" });
		state.onKeyboardHoldStart();

		expect(playSoundMock).toHaveBeenCalledTimes(1);
		expect(getModelStatusMock).toHaveBeenCalledTimes(1);
		expect(playSoundMock.mock.invocationCallOrder[0]).toBeLessThan(
			getModelStatusMock.mock.invocationCallOrder[0]
		);
	});

	it("shows a tenths timer while recording and clears it after stop", async () => {
		const timers = installTimerHarness();
		getModelStatusMock.mockReturnValue(okAsync({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-timer" });
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("recording");
		expect(state.recordingElapsedLabel).toBe("0.0s");

		timers.tickIntervals();
		expect(state.recordingElapsedLabel).toBe("0.1s");

		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("transcribing");
		expect(state.recordingElapsedLabel).toBeNull();
	});

	it("ignores download progress for other models", async () => {
		const pendingDownload = createPendingResult<void>();
		getModelStatusMock.mockReturnValue(okAsync({ is_downloaded: false, is_loaded: false }));
		downloadModelMock.mockReturnValue(
			ResultAsync.fromPromise(pendingDownload.promise, (error) => error as Error)
		);

		const state = new VoiceInputState({
			sessionId: "session-download-progress",
			getSelectedModelId: () => "small.en",
		});
		await state.registerListeners();

		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("downloading_model");

		const progressListener = listenMock.mock.calls.find(
			([eventName]) => eventName === "voice://model_download_progress"
		)?.[1] as
			| ((event: {
					payload: {
						model_id: string;
						downloaded_bytes: number;
						total_bytes: number;
						percent: number;
					};
			  }) => void)
			| undefined;

		if (!progressListener) {
			throw new Error("expected model_download_progress listener");
		}

		progressListener({
			payload: {
				model_id: "medium",
				downloaded_bytes: 50,
				total_bytes: 100,
				percent: 50,
			},
		});

		expect(state.downloadPercent).toBe(0);

		progressListener({
			payload: {
				model_id: "small.en",
				downloaded_bytes: 75,
				total_bytes: 100,
				percent: 75,
			},
		});

		expect(state.downloadPercent).toBe(75);

		pendingDownload.resolve(undefined);
		await flushAsync();
	});
});

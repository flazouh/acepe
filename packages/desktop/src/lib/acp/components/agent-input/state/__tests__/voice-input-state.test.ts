import { mock } from "bun:test";
import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cancelRecordingMock = vi.fn();
const getModelStatusMock = vi.fn();
const startRecordingMock = vi.fn();
const loadModelMock = vi.fn();
const downloadModelMock = vi.fn();
const stopRecordingMock = vi.fn();
const toastInfoMock = vi.fn();
const playSoundMock = vi.fn();

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

function toAgentResult<T>(
	operation: string,
	result: Effect.Effect<T, Error>
): Effect.Effect<T, Error> {
	// Mirrors AgentError: wraps the real failure in a generic "Agent operation
	// failed: <op>" message but keeps the original error reachable via
	// `.cause`, exactly like the production tauri-client boundary does.
	return result.pipe(
		Effect.mapError((cause) => {
			const wrapped = new Error(`Agent operation failed: ${operation}`);
			(wrapped as Error & { cause?: Error }).cause = cause;
			return wrapped;
		})
	);
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
		cancelRecordingMock.mockReset();
		getModelStatusMock.mockReset();
		startRecordingMock.mockReset();
		loadModelMock.mockReset();
		downloadModelMock.mockReset();
		stopRecordingMock.mockReset();
		toastInfoMock.mockReset();
		playSoundMock.mockReset();

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
		mock.module("runed", () => ({
			Context: class TestContext {
				private value: object | null = null;

				constructor(_name: string) {}

				exists(): boolean {
					return this.value !== null;
				}

				set(value: object): object {
					this.value = value;
					return value;
				}

				get(): object | null {
					return this.value;
				}

				getOr(fallback: object): object {
					return this.value ?? fallback;
				}
			},
			ElementSize: class TestElementSize {
				readonly width = 0;
				readonly height = 0;

				constructor(_node?: object | (() => object | null), _options?: object) {}
			},
			PersistedState: class TestPersistedState<TValue> {
				current: TValue | undefined;

				constructor(_key: string, initialValue?: TValue) {
					this.current = initialValue;
				}
			},
			Previous: class TestPrevious<TValue> {
				current: TValue | undefined;

				constructor(getValue: () => TValue) {
					this.current = getValue();
				}
			},
			AnimationFrames: class TestAnimationFrames {
				readonly current = false;

				start(): void {}

				stop(): void {}
			},
			Debounced: class TestDebounced<TValue> {
				current: TValue | undefined;

				constructor(value?: TValue) {
					this.current = value;
				}
			},
			IsMounted: class TestIsMounted {
				readonly current = true;
			},
			onClickOutside: () => () => {},
			useDebounce: (callback: () => void) => callback,
			useEventListener: () => () => {},
			useResizeObserver: () => () => {},
			watch: Object.assign(
				mock(() => () => {}),
				{
					pre: mock(() => () => {}),
				}
			),
		}));
		mock.module("$lib/acp/utils/sound.js", () => ({
			playSound: playSoundMock,
		}));
		const tauriClientVoiceMock = {
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
		};
		const tauriClientSpecifiers = [
			"$lib/utils/tauri-client.js",
			"../../../../utils/tauri-client.js",
			`${import.meta.dir}/../../../../../utils/tauri-client.ts`,
			`${import.meta.dir}/../../../../../utils/tauri-client.js`,
			`${import.meta.dir}/../../../../../utils/tauri-client/index.ts`,
			`${import.meta.dir}/../../../../../utils/tauri-client/index.js`,
		];
		for (const specifier of tauriClientSpecifiers) {
			mock.module(specifier, () => tauriClientVoiceMock);
		}
		mock.module("$lib/services/command-names.js", () => ({
			COMMANDS: {},
		}));

		(globalThis as { window?: unknown }).window = {};

		({ VoiceInputState } = await import("../voice-input-state.svelte.js"));

		cancelRecordingMock.mockReturnValue(Effect.succeed(undefined));
		startRecordingMock.mockReturnValue(Effect.succeed(undefined));
		loadModelMock.mockReturnValue(Effect.succeed(undefined));
		downloadModelMock.mockReturnValue(Effect.succeed(undefined));
		stopRecordingMock.mockReturnValue(Effect.succeed({ text: "", language: null, duration_ms: 0 }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("enters recording immediately when model is already loaded", async () => {
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-1" });
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("recording");
	});

	it("skips pointer capture on untrusted events so QA can start recording", async () => {
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: true, is_loaded: true }));

		const setPointerCapture = vi.fn(() => {
			throw new Error("InvalidStateError: pointer is not active");
		});
		const state = new VoiceInputState({ sessionId: "session-untrusted" });
		const event = {
			pointerId: 1,
			isTrusted: false,
			currentTarget: { setPointerCapture },
		} as unknown as PointerEvent;

		expect(() => {
			state.onMicPointerDown(event);
		}).not.toThrow();
		expect(setPointerCapture).not.toHaveBeenCalled();

		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("recording");
	});

	it("stops recording on pointer up while already recording", async () => {
		const pendingStop = createPendingResult<{
			text: string;
			language: string | null;
			duration_ms: number;
		}>();
		stopRecordingMock.mockReturnValue(
			fromPromise(
				() => pendingStop.promise,
				(error) => error as Error
			)
		);

		const state = new VoiceInputState({ sessionId: "session-2" });
		state.phase = "recording";

		state.onMicPointerUp();
		await Promise.resolve();

		expect(stopRecordingMock).toHaveBeenCalledWith("session-2", null);
		expect(state.phase).toBe("transcribing");

		pendingStop.resolve({ text: "", language: null, duration_ms: 0 });
		await flushAsync();
	});

	it("applies transcription text when stopRecording succeeds", async () => {
		const onTranscriptionReady = vi.fn();
		stopRecordingMock.mockReturnValue(
			Effect.succeed({ text: "hello world", language: null, duration_ms: 1000 })
		);

		const state = new VoiceInputState({
			sessionId: "session-race",
			onTranscriptionReady,
		});
		state.phase = "recording";

		state.stopRecording();
		await flushAsync();

		expect(toastInfoMock).not.toHaveBeenCalled();
		expect(onTranscriptionReady).toHaveBeenCalledWith("hello world");
		expect(state.phase).toBe("idle");
	});

	it("does not throw when dispose runs with no Tauri listeners", async () => {
		const state = new VoiceInputState({ sessionId: "session-stale-listener" });
		await state.registerListeners();

		expect(() => state.dispose()).not.toThrow();
		await flushAsync();
	});

	it("surfaces stopRecording failures while still transcribing", async () => {
		stopRecordingMock.mockReturnValue(
			Effect.fail(new Error("Agent operation failed: voice_stop_recording"))
		);

		const state = new VoiceInputState({ sessionId: "session-late-stop-error" });
		state.phase = "recording";

		state.stopRecording();
		await flushAsync();

		expect(state.phase).toBe("error");
		expect(state.errorMessage).toBe("Agent operation failed: voice_stop_recording");
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
		stopRecordingMock.mockReturnValue(
			Effect.succeed({ text: "   ", language: null, duration_ms: 1000 })
		);

		const state = new VoiceInputState({ sessionId: "session-3" });
		state.phase = "recording";
		state.stopRecording();
		await flushAsync();

		expect(toastInfoMock).toHaveBeenCalledTimes(1);
		expect(state.phase).toBe("idle");
	});

	it("surfaces model status failures", async () => {
		getModelStatusMock.mockReturnValue(Effect.fail(new Error("status failed")));

		const state = new VoiceInputState({ sessionId: "session-4" });
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		// The real cause ("status failed") lands in errorMessage, not the
		// opaque "Agent operation failed: <op>" wrapper — see
		// resolveVoiceFailureMessage.
		expect(state.errorMessage).toBe("status failed");
	});

	it("surfaces distinct, human-readable messages for distinct failure kinds", async () => {
		getModelStatusMock.mockReturnValue(
			Effect.fail(
				new Error(
					"Microphone permission denied. Check System Settings → Privacy & Security → Microphone."
				)
			)
		);

		const permissionState = new VoiceInputState({ sessionId: "session-permission" });
		permissionState.onMicPointerDown(createPointerEvent());
		permissionState.onMicPointerUp();
		await flushAsync();

		expect(permissionState.errorMessage).toBe(
			"Microphone permission denied. Check System Settings → Privacy & Security → Microphone."
		);

		getModelStatusMock.mockReturnValue(
			Effect.fail(
				new Error(
					"No audio input device available. On macOS, check System Settings → Privacy & Security → Microphone."
				)
			)
		);

		const noDeviceState = new VoiceInputState({ sessionId: "session-no-device" });
		noDeviceState.onMicPointerDown(createPointerEvent());
		noDeviceState.onMicPointerUp();
		await flushAsync();

		expect(noDeviceState.errorMessage).toBe(
			"No audio input device available. On macOS, check System Settings → Privacy & Security → Microphone."
		);

		expect(noDeviceState.errorMessage).not.toBe(permissionState.errorMessage);
		expect(noDeviceState.errorMessage).not.toBeNull();
		expect(permissionState.errorMessage).not.toBeNull();
	});

	it("starts recording immediately for keyboard press-and-hold", async () => {
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: true, is_loaded: true }));
		const pendingStop = createPendingResult<{
			text: string;
			language: string | null;
			duration_ms: number;
		}>();
		stopRecordingMock.mockReturnValue(
			fromPromise(
				() => pendingStop.promise,
				(error) => error as Error
			)
		);

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

		pendingStop.resolve({ text: "", language: null, duration_ms: 0 });
		await flushAsync();
	});

	it("cancels keyboard press-and-hold if released during startup", async () => {
		const pendingModelStatus = createPendingResult<{
			is_downloaded: boolean;
			is_loaded: boolean;
		}>();
		getModelStatusMock.mockReturnValue(
			fromPromise(
				() => pendingModelStatus.promise,
				(error) => error as Error
			)
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
			fromPromise(
				() => pendingModelStatus.promise,
				(error) => error as Error
			)
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
			fromPromise(
				() => pendingModelStatus.promise,
				(error) => error as Error
			)
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
			fromPromise(
				() => pendingModelStatus.promise,
				(error) => error as Error
			)
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
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-sound-order" });
		state.onKeyboardHoldStart();

		expect(playSoundMock).toHaveBeenCalledTimes(1);
		expect(getModelStatusMock).toHaveBeenCalledTimes(1);
		expect(playSoundMock.mock.invocationCallOrder[0]).toBeLessThan(
			getModelStatusMock.mock.invocationCallOrder[0]
		);
	});

	it("plays the start sound on pointer down before press-and-hold recording starts", () => {
		const timers = installTimerHarness();
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-pointer-sound-order" });
		state.onMicPointerDown(createPointerEvent());

		expect(playSoundMock).toHaveBeenCalledTimes(1);
		expect(getModelStatusMock).not.toHaveBeenCalled();

		timers.runPendingTimeouts();

		expect(getModelStatusMock).toHaveBeenCalledTimes(1);
		expect(playSoundMock.mock.invocationCallOrder[0]).toBeLessThan(
			getModelStatusMock.mock.invocationCallOrder[0]
		);
	});

	it("shows a tenths timer while recording and clears it after stop", async () => {
		const timers = installTimerHarness();
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: true, is_loaded: true }));
		const pendingStop = createPendingResult<{
			text: string;
			language: string | null;
			duration_ms: number;
		}>();
		stopRecordingMock.mockReturnValue(
			fromPromise(
				() => pendingStop.promise,
				(error) => error as Error
			)
		);

		const state = new VoiceInputState({ sessionId: "session-timer" });
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(state.phase).toBe("recording");
		expect(state.recordingElapsedLabel).toBe("0.0s");

		timers.tickIntervals();
		expect(state.recordingElapsedLabel).toBe("0.1s");

		state.onMicPointerUp();
		await Promise.resolve();

		expect(state.phase).toBe("transcribing");
		expect(state.recordingElapsedLabel).toBeNull();

		pendingStop.resolve({ text: "", language: null, duration_ms: 0 });
		await flushAsync();
	});

	it("does not stream download percent because voice progress is not on the contract", async () => {
		const pendingDownload = createPendingResult<void>();
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: false, is_loaded: false }));
		downloadModelMock.mockReturnValue(
			fromPromise(
				() => pendingDownload.promise,
				(error) => error as Error
			)
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
		expect(state.downloadPercent).toBe(0);

		pendingDownload.resolve(undefined);
		await flushAsync();
	});

	it("asks the configured backend before live speech recognition", async () => {
		const onTranscriptionReady = vi.fn();
		const session = {
			start: vi.fn(() => "started" as const),
			stop: vi.fn(async () => "hello from mic"),
			abort: vi.fn(),
		};
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: true, is_loaded: true }));
		stopRecordingMock.mockReturnValue(
			Effect.succeed({ text: "hello from the backend", language: null, duration_ms: 1000 })
		);

		const state = new VoiceInputState({
			sessionId: "session-backend-first",
			onTranscriptionReady,
			createLiveSpeechSession: () => session,
		});
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(getModelStatusMock).toHaveBeenCalled();
		expect(session.start).not.toHaveBeenCalled();
		expect(state.phase).toBe("recording");

		state.stopRecording();
		await flushAsync();

		expect(stopRecordingMock).toHaveBeenCalled();
		expect(onTranscriptionReady).toHaveBeenCalledWith("hello from the backend");
	});

	it("falls back to live speech recognition when the backend refuses", async () => {
		const onTranscriptionReady = vi.fn();
		const session = {
			start: vi.fn(() => "started" as const),
			stop: vi.fn(async () => "hello from mic"),
			abort: vi.fn(),
		};
		loadModelMock.mockReturnValue(
			toAgentResult("voice.model.load", Effect.fail(new Error("no command configured")))
		);
		getModelStatusMock.mockReturnValue(Effect.succeed({ is_downloaded: true, is_loaded: false }));

		const state = new VoiceInputState({
			sessionId: "session-live-speech",
			onTranscriptionReady,
			createLiveSpeechSession: () => session,
		});
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await flushAsync();

		expect(session.start).toHaveBeenCalled();
		expect(state.phase).toBe("recording");

		state.stopRecording();
		await flushAsync();

		expect(stopRecordingMock).not.toHaveBeenCalled();
		expect(onTranscriptionReady).toHaveBeenCalledWith("hello from mic");
		expect(state.phase).toBe("idle");
	});
});

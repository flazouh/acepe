import { mock } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.fn();
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
		mock.module("runed", () => ({}));
		mock.module("$lib/acp/utils/sound.js", () => ({
			playSound: playSoundMock,
		}));
		mock.module("$lib/utils/tauri-client.js", () => ({
			tauriClient: {
				voice: {
					cancelRecording: cancelRecordingMock,
					getModelStatus: getModelStatusMock,
					startRecording: startRecordingMock,
					loadModel: loadModelMock,
					downloadModel: downloadModelMock,
					stopRecording: stopRecordingMock,
				},
			},
		}));

		({ VoiceInputState } = await import("../voice-input-state.svelte.js"));

		listenMock.mockResolvedValue(() => undefined);
		cancelRecordingMock.mockReturnValue(okAsync(undefined));
		startRecordingMock.mockReturnValue(okAsync(undefined));
		loadModelMock.mockReturnValue(okAsync(undefined));
		downloadModelMock.mockReturnValue(okAsync(undefined));
		stopRecordingMock.mockReturnValue(okAsync(undefined));
	});

	it("enters recording immediately when model is already loaded", async () => {
		getModelStatusMock.mockReturnValue(okAsync({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-1" });
		state.onMicPointerDown(createPointerEvent());
		state.onMicPointerUp();
		await Promise.resolve();
		await Promise.resolve();

		expect(startRecordingMock).toHaveBeenCalledWith("session-1");
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
		stopRecordingMock.mockReturnValue(ResultAsync.fromPromise(pendingStop.promise, (error) => error as Error));

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

	it("shows no speech toast and returns to idle on empty transcription", async () => {
		const state = new VoiceInputState({ sessionId: "session-3" });
		await state.registerListeners();

		const transcriptionListener = listenMock.mock.calls.find(
			([eventName]) => eventName === "voice://transcription_complete"
		)?.[1] as ((event: { payload: { session_id: string; text: string; language: string | null; duration_ms: number } }) => void) | undefined;

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
		await Promise.resolve();

		expect(state.errorMessage).toBe("status failed");
	});

	it("starts recording immediately for keyboard press-and-hold", async () => {
		getModelStatusMock.mockReturnValue(okAsync({ is_downloaded: true, is_loaded: true }));

		const state = new VoiceInputState({ sessionId: "session-keyboard" });

		state.onKeyboardHoldStart();
		await Promise.resolve();
		await Promise.resolve();

		expect(playSoundMock).toHaveBeenCalledTimes(1);
		expect(startRecordingMock).toHaveBeenCalledWith("session-keyboard");
		expect(state.phase).toBe("recording");

		state.onKeyboardHoldEnd();
		await Promise.resolve();

		expect(playSoundMock).toHaveBeenCalledTimes(2);
		expect(stopRecordingMock).toHaveBeenCalledWith("session-keyboard", null);
		expect(state.phase).toBe("transcribing");
	});
});

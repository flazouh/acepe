import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "svelte-sonner";
import { SoundEffect } from "$lib/acp/types/sounds.js";
import { playSound } from "$lib/acp/utils/sound.js";
import * as m from "$lib/paraglide/messages.js";
import { tauriClient } from "../../../../utils/tauri-client.js";
import type { AppError } from "../../../errors/app-error.js";
import type {
	AmplitudePayload,
	RecordingErrorPayload,
	TranscriptionCompletePayload,
	TranscriptionErrorPayload,
	VoiceInputPhase,
	VoiceModelDownloadProgress,
} from "../../../types/voice-input.js";
import { canCancelVoiceInteraction, shouldShowVoiceOverlay } from "../logic/voice-ui-state.js";
import { transition } from "./voice-transitions.js";
import { WaveformState } from "./waveform-state.svelte.js";

const ERROR_RESET_DELAY_MS = 8000;
const TRANSCRIBING_WATCHDOG_MS = 30_000;

function log(msg: string, data?: Record<string, unknown>): void {
	if (data) {
		console.log(`[voice] ${msg}`, data);
	} else {
		console.log(`[voice] ${msg}`);
	}
}

function previewText(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= 80) {
		return normalized;
	}
	return `${normalized.slice(0, 80)}...`;
}

export class VoiceInputState {
	static readonly PRESS_AND_HOLD_THRESHOLD_MS = 500;

	/** Current state machine phase */
	phase = $state<VoiceInputPhase>("idle");

	/** Waveform visualization state (separate class for performance) */
	readonly waveform = new WaveformState();

	/** Model download progress percentage 0-100 (set during downloading_model phase) */
	downloadPercent = $state<number>(0);

	/** Whether the model is being loaded into memory (after download, before recording) */
	isLoadingModel = $state(false);

	/** Error message (set on error phase) */
	errorMessage = $state<string | null>(null);

	/** Whether recording was started via press-and-hold (vs click-to-toggle) */
	isPressAndHold = $state(false);

	/** Derived: is any voice UI active (not idle) */
	readonly isActive = $derived(this.phase !== "idle");

	/** Derived: show waveform overlay (recording or transcribing) */
	readonly showOverlay = $derived(shouldShowVoiceOverlay(this.phase));

	private recordingElapsedTenths = $state(0);
	/** Derived: mic button is in a non-idle voice workflow state. */
	readonly isBusy = $derived(
		this.phase === "checking_permission" ||
			this.phase === "downloading_model" ||
			this.phase === "loading_model" ||
			this.phase === "transcribing"
	);
	readonly recordingElapsedLabel = $derived(
		this.phase === "recording" ? `${(this.recordingElapsedTenths / 10).toFixed(1)}s` : null
	);

	private readonly unlisteners: UnlistenFn[] = [];
	private pressTimer: ReturnType<typeof setTimeout> | null = null;
	private errorResetTimer: ReturnType<typeof setTimeout> | null = null;
	private recordingElapsedTimer: ReturnType<typeof setInterval> | null = null;
	private transcribingWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
	private activeDownloadModelId: string | null = null;

	private readonly sessionId: string;
	private readonly onTranscriptionReady: ((text: string) => void) | null;
	private readonly onOverlayDeactivated: (() => void) | null;
	private readonly getSelectedLanguage: () => string;
	private readonly getSelectedModelId: () => string;
	private isDisposed = false;

	constructor(options: {
		sessionId: string;
		onTranscriptionReady?: (text: string) => void;
		onOverlayDeactivated?: () => void;
		getSelectedLanguage?: () => string;
		getSelectedModelId?: () => string;
	}) {
		this.sessionId = options.sessionId;
		this.onTranscriptionReady =
			options.onTranscriptionReady !== undefined ? options.onTranscriptionReady : null;
		this.onOverlayDeactivated =
			options.onOverlayDeactivated !== undefined ? options.onOverlayDeactivated : null;
		this.getSelectedLanguage =
			options.getSelectedLanguage !== undefined ? options.getSelectedLanguage : () => "auto";
		this.getSelectedModelId =
			options.getSelectedModelId !== undefined ? options.getSelectedModelId : () => "small.en";
		log("VoiceInputState created", { sessionId: this.sessionId });
	}

	/** Register Tauri event listeners. Call once from onMount. */
	async registerListeners(): Promise<void> {
		log("Registering Tauri event listeners...");
		const [
			amplitudeUnlisten,
			recErrUnlisten,
			transcCompleteUnlisten,
			transcErrUnlisten,
			dlProgressUnlisten,
		] = await Promise.all([
			listen<AmplitudePayload>("voice://amplitude", (event) => {
				if (this.isDisposed) return;
				if (event.payload.session_id !== this.sessionId) {
					log("amplitude event: session_id mismatch", {
						expected: this.sessionId,
						got: event.payload.session_id,
					});
					return;
				}
				if (this.phase !== "recording") {
					log("amplitude event: ignored (not recording)", { phase: this.phase });
					return;
				}
				this.waveform.pushBatch(event.payload.values);
			}),
			listen<RecordingErrorPayload>("voice://recording_error", (event) => {
				if (this.isDisposed) return;
				if (event.payload.session_id !== this.sessionId) return;
				log("recording_error event", { message: event.payload.message, phase: this.phase });
				this.setError(event.payload.message);
			}),
			listen<TranscriptionCompletePayload>("voice://transcription_complete", (event) => {
				if (this.isDisposed) return;
				if (event.payload.session_id !== this.sessionId) return;
				const text = event.payload.text.trim();
				log("transcription_complete event", {
					textLength: event.payload.text.length,
					trimmedTextLength: text.length,
					textPreview: previewText(event.payload.text),
					language: event.payload.language,
					duration_ms: event.payload.duration_ms,
					phase: this.phase,
				});
				this.clearWatchdog();
				if (text) {
					this.onTranscriptionReady?.(text);
				} else {
					toast.info(m.voice_no_speech_detected());
				}
				this.transitionTo("complete");
				// Auto-advance complete → idle (no timer needed — fire immediately)
				this.transitionTo("idle");
			}),
			listen<TranscriptionErrorPayload>("voice://transcription_error", (event) => {
				if (this.isDisposed) return;
				if (event.payload.session_id !== this.sessionId) return;
				log("transcription_error event", { message: event.payload.message, phase: this.phase });
				this.clearWatchdog();
				this.setError(event.payload.message);
			}),
			listen<VoiceModelDownloadProgress>("voice://model_download_progress", (event) => {
				if (this.isDisposed) return;
				if (this.phase !== "downloading_model") return;
				if (this.activeDownloadModelId === null) return;
				if (event.payload.model_id !== this.activeDownloadModelId) {
					log("download_progress: ignored (model_id mismatch)", {
						expected: this.activeDownloadModelId,
						got: event.payload.model_id,
					});
					return;
				}
				const prevPercent = this.downloadPercent;
				this.downloadPercent = event.payload.percent;
				// Log at 0%, 25%, 50%, 75%, 100% to avoid spam
				if (
					Math.floor(event.payload.percent / 25) !== Math.floor(prevPercent / 25) ||
					event.payload.percent >= 100
				) {
					log("download_progress", {
						percent: event.payload.percent,
						downloaded: event.payload.downloaded_bytes,
						total: event.payload.total_bytes,
						phase: this.phase,
					});
				}
			}),
		]);

		this.unlisteners.push(
			amplitudeUnlisten,
			recErrUnlisten,
			transcCompleteUnlisten,
			transcErrUnlisten,
			dlProgressUnlisten
		);
		log("Event listeners registered");
	}

	/** Unregister listeners and cancel any timers. Call from onDestroy. */
	dispose(): void {
		log("dispose()", { phase: this.phase, isDisposed: this.isDisposed });
		this.isDisposed = true;
		for (const unlisten of this.unlisteners) {
			unlisten();
		}
		this.unlisteners.length = 0;
		this.clearPressTimer();
		this.clearWatchdog();
		this.stopRecordingElapsedTimer();
		if (this.errorResetTimer !== null) {
			clearTimeout(this.errorResetTimer);
			this.errorResetTimer = null;
		}
		this.activeDownloadModelId = null;
		// Best-effort cancel if in-flight
		if (canCancelVoiceInteraction(this.phase)) {
			log("dispose: cancelling in-flight recording");
			tauriClient.voice.cancelRecording(this.sessionId);
		}
	}

	// ── Press-and-hold interaction ───────────────────────────────────────────────

	/** Called on pointerdown on the mic button. */
	onMicPointerDown(event: PointerEvent): void {
		log("onMicPointerDown", { phase: this.phase });
		if (this.phase !== "idle") {
			log("onMicPointerDown: ignored (not idle)");
			return;
		}
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		this.startPressAndHoldTimer();
	}

	/** Called on keydown for keyboard press-and-hold interactions. */
	onKeyboardHoldStart(): void {
		log("onKeyboardHoldStart", { phase: this.phase });
		if (this.phase !== "idle") {
			log("onKeyboardHoldStart: ignored (not idle)");
			return;
		}
		this.clearPressTimer();
		this.isPressAndHold = true;
		playSound(SoundEffect.DictationStart);
		log("keyboard press-and-hold: starting recording immediately");
		this.startRecording();
	}

	/** Called on keyup for keyboard press-and-hold interactions. */
	onKeyboardHoldEnd(): void {
		log("onKeyboardHoldEnd", {
			phase: this.phase,
			pressTimerActive: this.pressTimer !== null,
			isPressAndHold: this.isPressAndHold,
		});
		if (this.pressTimer !== null) {
			this.clearPressTimer();
			this.isPressAndHold = false;
			return;
		}
		if (!this.isPressAndHold) {
			return;
		}
		this.isPressAndHold = false;
		if (this.phase === "recording") {
			log("keyboard press-and-hold release: stopping recording");
			playSound(SoundEffect.DictationStop);
			this.stopRecording();
			return;
		}
		if (canCancelVoiceInteraction(this.phase)) {
			log("keyboard press-and-hold release: cancelling startup");
			this.cancelRecording();
		}
	}

	private startPressAndHoldTimer(): void {
		this.clearPressTimer();
		this.pressTimer = setTimeout(() => {
			if (this.isDisposed) return;
			this.pressTimer = null;
			this.isPressAndHold = true;
			log("press-and-hold threshold reached, starting recording");
			this.startRecording();
		}, VoiceInputState.PRESS_AND_HOLD_THRESHOLD_MS);
	}

	/** Called on pointerup on the mic button. */
	onMicPointerUp(): void {
		log("onMicPointerUp", {
			phase: this.phase,
			pressTimerActive: this.pressTimer !== null,
			isPressAndHold: this.isPressAndHold,
		});
		if (this.pressTimer !== null) {
			// Released before threshold → toggle click
			this.clearPressTimer();
			if (this.phase === "idle") {
				this.isPressAndHold = false;
				log("click-to-toggle: starting recording");
				playSound(SoundEffect.DictationStart);
				this.startRecording();
			} else if (this.phase === "recording") {
				log("click-to-toggle: stopping recording");
				playSound(SoundEffect.DictationStop);
				this.stopRecording();
			}
		} else if (this.isPressAndHold && this.phase === "recording") {
			// Released after threshold → end hold
			this.isPressAndHold = false;
			log("press-and-hold release: stopping recording");
			playSound(SoundEffect.DictationStop);
			this.stopRecording();
		} else if (this.isPressAndHold && canCancelVoiceInteraction(this.phase)) {
			this.isPressAndHold = false;
			log("press-and-hold release: cancelling startup");
			this.cancelRecording();
		} else if (this.phase === "recording") {
			// Click-to-toggle stop: pointerdown was ignored while recording, so stop on release.
			log("click-to-toggle: stopping recording");
			playSound(SoundEffect.DictationStop);
			this.stopRecording();
		} else if (canCancelVoiceInteraction(this.phase)) {
			log("click-to-toggle: cancelling startup");
			this.cancelRecording();
		}
	}

	/** Called on pointercancel (OS gesture) to prevent stranding. */
	onMicPointerCancel(): void {
		log("onMicPointerCancel", { phase: this.phase });
		this.clearPressTimer();
		this.isPressAndHold = false;
		if (canCancelVoiceInteraction(this.phase)) {
			this.cancelRecording();
		}
	}

	/** Manual stop (called from overlay Stop button or keyboard). */
	stopRecording(): void {
		log("stopRecording()", {
			phase: this.phase,
			currentLevel: this.waveform.currentLevel,
			meterLevels: this.waveform.meterLevels,
		});
		if (this.phase !== "recording") {
			log("stopRecording: ignored (not recording)");
			return;
		}
		this.waveform.reset();
		this.transitionTo("transcribing");
		this.startWatchdog();
		const selectedLanguage = this.getSelectedLanguage();
		const language = selectedLanguage === "auto" ? null : selectedLanguage;
		log("calling tauriClient.voice.stopRecording", { sessionId: this.sessionId, language });
		tauriClient.voice.stopRecording(this.sessionId, language).match(
			() => {
				log("stopRecording: success, waiting for transcription event");
			},
			(err: AppError) => {
				log("stopRecording: FAILED", { error: err.message });
				this.clearWatchdog();
				this.setError(err.message ?? m.voice_error_stop_failed());
			}
		);
	}

	/** Cancel recording (Escape / Cancel button). */
	cancelRecording(): void {
		log("cancelRecording()", {
			phase: this.phase,
			canCancel: canCancelVoiceInteraction(this.phase),
		});
		if (!canCancelVoiceInteraction(this.phase)) {
			log("cancelRecording: ignored (phase not cancellable)");
			return;
		}
		this.clearWatchdog();
		log("calling tauriClient.voice.cancelRecording", { sessionId: this.sessionId });
		tauriClient.voice.cancelRecording(this.sessionId);
		this.waveform.reset();
		this.isLoadingModel = false;
		this.isPressAndHold = false;
		this.activeDownloadModelId = null;
		this.downloadPercent = 0;
		this.transitionTo("cancelled");
		this.transitionTo("idle");
	}

	dismissError(): void {
		log("dismissError()", { phase: this.phase });
		if (this.errorResetTimer !== null) {
			clearTimeout(this.errorResetTimer);
			this.errorResetTimer = null;
		}
		this.errorMessage = null;
		this.transitionTo("idle");
	}

	// ── Private helpers ──────────────────────────────────────────────────────────

	private startRecording(): void {
		const selectedModelId = this.getSelectedModelId();
		log("startRecording()", { selectedModelId, sessionId: this.sessionId });
		this.transitionTo("checking_permission");
		this.waveform.primeStartup();

		log("calling tauriClient.voice.getModelStatus", { modelId: selectedModelId });
		tauriClient.voice.getModelStatus(selectedModelId).match(
			(modelInfo) => {
				log("getModelStatus: result", {
					is_downloaded: modelInfo.is_downloaded,
					is_loaded: modelInfo.is_loaded,
				});
				if (!this.shouldContinueFromPhase("checking_permission", "getModelStatus")) {
					return;
				}
				if (!modelInfo.is_downloaded) {
					this.transitionTo("downloading_model");
					this.activeDownloadModelId = selectedModelId;
					this.downloadPercent = 0;
					log("calling tauriClient.voice.downloadModel", { modelId: selectedModelId });
					tauriClient.voice.downloadModel(selectedModelId).match(
						() => {
							log("downloadModel: success");
							this.activeDownloadModelId = null;
							this.downloadPercent = 100;
							if (!this.shouldContinueFromPhase("downloading_model", "downloadModel")) {
								return;
							}
							this.loadModelAndRecord(selectedModelId);
						},
						(err: AppError) => {
							log("downloadModel: FAILED", { error: err.message });
							this.activeDownloadModelId = null;
							this.setError(err.message ?? m.voice_error_download_failed());
						}
					);
				} else if (modelInfo.is_loaded) {
					log("getModelStatus: model already loaded, starting recording immediately");
					if (!this.shouldContinueFromPhase("checking_permission", "getModelStatus.is_loaded")) {
						return;
					}
					this.beginRecording();
				} else {
					this.loadModelAndRecord(selectedModelId);
				}
			},
			(err: AppError) => {
				log("getModelStatus: FAILED", { error: err.message });
				this.setError(err.message ?? m.voice_error_model_status_failed());
			}
		);
	}

	private loadModelAndRecord(modelId: string): void {
		log("loadModelAndRecord()", { modelId, phase: this.phase });

		this.transitionTo("loading_model");
		this.isLoadingModel = true;

		log("calling tauriClient.voice.loadModel", { modelId });
		const t0 = performance.now();
		tauriClient.voice.loadModel(modelId).match(
			() => {
				const elapsed = Math.round(performance.now() - t0);
				log("loadModel: success", { elapsed_ms: elapsed });
				this.isLoadingModel = false;
				if (this.isDisposed) {
					log("loadModel: disposed after load, aborting");
					return;
				}
				if (this.phase !== "loading_model") {
					log("loadModel: phase changed during load, aborting", { phase: this.phase });
					return;
				}
				this.beginRecording();
			},
			(err: AppError) => {
				log("loadModel: FAILED", { error: err.message });
				this.isLoadingModel = false;
				this.setError(err.message ?? m.voice_error_load_failed());
			}
		);
	}

	private beginRecording(): void {
		log("calling tauriClient.voice.startRecording", { sessionId: this.sessionId });
		tauriClient.voice.startRecording(this.sessionId).match(
			() => {
				log("startRecording: success");
				this.transitionTo("recording");
			},
			(err: AppError) => {
				log("startRecording: FAILED", { error: err.message });
				this.setError(err.message ?? m.voice_error_start_failed());
			}
		);
	}

	private transitionTo(next: VoiceInputPhase): void {
		const prev = this.phase;
		const result = transition(this.phase, next);
		if (result !== null) {
			this.phase = result;
			if (result === "recording") {
				this.startRecordingElapsedTimer();
			} else if (prev === "recording") {
				this.stopRecordingElapsedTimer();
			}
			log(`transition: ${prev} → ${result}`);
			if (!this.isDisposed && shouldShowVoiceOverlay(prev) && !shouldShowVoiceOverlay(result)) {
				this.onOverlayDeactivated?.();
			}
		} else {
			log(`transition BLOCKED: ${prev} → ${next}`);
		}
	}

	private setError(message: string): void {
		log("setError()", { message, phase: this.phase });
		this.errorMessage = message;
		this.transitionTo("error");
		if (this.errorResetTimer !== null) clearTimeout(this.errorResetTimer);
		this.errorResetTimer = setTimeout(() => {
			if (this.isDisposed) return;
			this.errorResetTimer = null;
			this.errorMessage = null;
			log("error auto-reset timer fired");
			this.transitionTo("idle");
		}, ERROR_RESET_DELAY_MS);
	}

	private clearPressTimer(): void {
		if (this.pressTimer !== null) {
			clearTimeout(this.pressTimer);
			this.pressTimer = null;
		}
	}

	private startWatchdog(): void {
		this.clearWatchdog();
		this.transcribingWatchdogTimer = setTimeout(() => {
			if (this.isDisposed) return;
			this.transcribingWatchdogTimer = null;
			if (this.phase === "transcribing") {
				log("transcribing watchdog fired — timeout");
				this.setError(m.voice_error_transcription_timeout());
			}
		}, TRANSCRIBING_WATCHDOG_MS);
	}

	private clearWatchdog(): void {
		if (this.transcribingWatchdogTimer !== null) {
			clearTimeout(this.transcribingWatchdogTimer);
			this.transcribingWatchdogTimer = null;
		}
	}

	private startRecordingElapsedTimer(): void {
		this.stopRecordingElapsedTimer();
		this.recordingElapsedTenths = 0;
		this.recordingElapsedTimer = setInterval(() => {
			if (this.isDisposed || this.phase !== "recording") {
				this.stopRecordingElapsedTimer();
				return;
			}

			this.recordingElapsedTenths += 1;
		}, 100);
	}

	private stopRecordingElapsedTimer(): void {
		if (this.recordingElapsedTimer !== null) {
			clearInterval(this.recordingElapsedTimer);
			this.recordingElapsedTimer = null;
		}

		this.recordingElapsedTenths = 0;
	}

	private shouldContinueFromPhase(expectedPhase: VoiceInputPhase, operation: string): boolean {
		if (this.isDisposed) {
			log(`${operation}: disposed, aborting`);
			return false;
		}

		if (this.phase !== expectedPhase) {
			log(`${operation}: phase changed, aborting`, { expectedPhase, phase: this.phase });
			return false;
		}

		return true;
	}
}

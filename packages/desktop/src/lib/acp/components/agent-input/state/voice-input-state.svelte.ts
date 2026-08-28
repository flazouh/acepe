import * as Effect from "effect/Effect";
import { toast } from "svelte-sonner";
import { SoundEffect } from "$lib/acp/types/sounds.js";
import { playSound } from "$lib/acp/utils/sound.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { AppError } from "../../../errors/app-error.js";
import type { VoiceInputPhase } from "../../../types/voice-input.js";
import {
	type LiveSpeechSession,
	readWindowLiveSpeechSession,
} from "../logic/live-speech-recognition.js";
import { resolveVoiceFailureMessage } from "../logic/voice-error-message.js";
import { canCancelVoiceInteraction, shouldShowVoiceOverlay } from "../logic/voice-ui-state.js";
import { transition } from "./voice-transitions.js";
import { WaveformState } from "./waveform-state.svelte.js";

const ERROR_RESET_DELAY_MS = 8000;
const TRANSCRIBING_WATCHDOG_MS = 30_000;

function log(_msg: string, _data?: Record<string, unknown>): void {}

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
	readonly recordingElapsedTenthsDisplay = $derived(
		this.phase === "recording" ? this.recordingElapsedTenths : null
	);
	readonly recordingElapsedLabel = $derived(
		this.recordingElapsedTenthsDisplay === null
			? null
			: `${(this.recordingElapsedTenthsDisplay / 10).toFixed(1)}s`
	);

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
	private readonly createLiveSpeechSession: () => LiveSpeechSession | null;
	private activeLiveSpeech: LiveSpeechSession | null = null;
	private isDisposed = false;

	constructor(options: {
		sessionId: string;
		onTranscriptionReady?: (text: string) => void;
		onOverlayDeactivated?: () => void;
		getSelectedLanguage?: () => string;
		getSelectedModelId?: () => string;
		createLiveSpeechSession?: () => LiveSpeechSession | null;
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
		this.createLiveSpeechSession =
			options.createLiveSpeechSession !== undefined
				? options.createLiveSpeechSession
				: readWindowLiveSpeechSession;
		log("VoiceInputState created", { sessionId: this.sessionId });
	}

	/** Voice amplitude and transcription now arrive through dispatch/snapshot. */
	async registerListeners(): Promise<void> {
		log("Voice listeners skipped; transcription completes on stopRecording");
	}

	/** Unregister listeners and cancel any timers. Call from onDestroy. */
	dispose(): void {
		log("dispose()", { phase: this.phase, isDisposed: this.isDisposed });
		this.isDisposed = true;
		this.abortLiveSpeech();
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
			void Effect.runPromise(
				tauriClient.voice
					.cancelRecording(this.sessionId)
					.pipe(Effect.catch(() => Effect.succeed(undefined)))
			);
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
		if (event.isTrusted === true) {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		}
		playSound(SoundEffect.DictationStart);
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
		log("keyboard press-and-hold: starting recording immediately");
		playSound(SoundEffect.DictationStart);
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
			playSound(SoundEffect.SoundDown);
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
				this.startRecording();
			} else if (this.phase === "recording") {
				log("click-to-toggle: stopping recording");
				playSound(SoundEffect.SoundDown);
				this.stopRecording();
			}
		} else if (this.isPressAndHold && this.phase === "recording") {
			// Released after threshold → end hold
			this.isPressAndHold = false;
			log("press-and-hold release: stopping recording");
			playSound(SoundEffect.SoundDown);
			this.stopRecording();
		} else if (this.isPressAndHold && canCancelVoiceInteraction(this.phase)) {
			this.isPressAndHold = false;
			log("press-and-hold release: cancelling startup");
			this.cancelRecording();
		} else if (this.phase === "recording") {
			// Click-to-toggle stop: pointerdown was ignored while recording, so stop on release.
			log("click-to-toggle: stopping recording");
			playSound(SoundEffect.SoundDown);
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
		if (this.stopLiveSpeechRecording()) {
			return;
		}
		const selectedLanguage = this.getSelectedLanguage();
		const language = selectedLanguage === "auto" ? null : selectedLanguage;
		log("calling tauriClient.voice.stopRecording", { sessionId: this.sessionId, language });
		void Effect.runPromise(
			tauriClient.voice.stopRecording(this.sessionId, language).pipe(
				Effect.match({
					onSuccess: (result) => {
						log("stopRecording: success", {
							textPreview: previewText(result.text),
							language: result.language,
							duration_ms: result.duration_ms,
						});
						if (!this.shouldContinueFromPhase("transcribing", "stopRecording.success")) {
							return;
						}
						this.finishTranscription(result.text);
					},
					onFailure: (err: AppError) => {
						log("stopRecording: FAILED", { error: err.message });
						if (!this.shouldContinueFromPhase("transcribing", "stopRecording.error")) {
							return;
						}
						this.clearWatchdog();
						this.setError(resolveVoiceFailureMessage(err, "Failed to stop recording"));
					},
				})
			)
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
		this.abortLiveSpeech();
		log("calling tauriClient.voice.cancelRecording", { sessionId: this.sessionId });
		void Effect.runPromise(
			tauriClient.voice
				.cancelRecording(this.sessionId)
				.pipe(Effect.catch(() => Effect.succeed(undefined)))
		);
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

	private resolveLiveSpeechLanguage(): string | null {
		const selectedLanguage = this.getSelectedLanguage();
		if (selectedLanguage === "auto") {
			return null;
		}
		return selectedLanguage;
	}

	/**
	 * Called when the configured backend cannot take the recording. Live speech
	 * recognition answers if the webview has it; otherwise the operator hears why
	 * the backend refused, which is the more useful of the two messages.
	 */
	private fallBackToLiveSpeech(error: AppError, fallbackMessage: string): void {
		log("falling back to live speech", { reason: error.message });
		if (this.beginLiveSpeechRecording()) {
			return;
		}
		this.setError(resolveVoiceFailureMessage(error, fallbackMessage));
	}

	private beginLiveSpeechRecording(): boolean {
		const session = this.createLiveSpeechSession();
		if (session === null) {
			return false;
		}
		const started = session.start(this.resolveLiveSpeechLanguage(), {
			onFailure: (message) => {
				this.abortLiveSpeech();
				if (this.phase === "recording" || this.phase === "checking_permission") {
					this.setError(message);
				}
			},
		});
		if (started === "failed") {
			this.setError("Could not start speech recognition");
			return true;
		}
		this.activeLiveSpeech = session;
		this.transitionTo("recording");
		return true;
	}

	private stopLiveSpeechRecording(): boolean {
		const session = this.activeLiveSpeech;
		if (session === null) {
			return false;
		}
		this.activeLiveSpeech = null;
		void Effect.runPromise(
			Effect.tryPromise({
				try: () => session.stop(),
				catch: (cause) =>
					cause instanceof Error ? cause : new Error("Failed to stop speech recognition"),
			}).pipe(
				Effect.match({
					onSuccess: (text) => {
						if (!this.shouldContinueFromPhase("transcribing", "liveSpeech.stop")) {
							return;
						}
						this.finishTranscription(text);
					},
					onFailure: (err) => {
						if (!this.shouldContinueFromPhase("transcribing", "liveSpeech.stop.error")) {
							return;
						}
						this.clearWatchdog();
						this.setError(err.message.trim().length > 0 ? err.message : "Failed to stop recording");
					},
				})
			)
		);
		return true;
	}

	private abortLiveSpeech(): void {
		if (this.activeLiveSpeech === null) {
			return;
		}
		this.activeLiveSpeech.abort();
		this.activeLiveSpeech = null;
	}

	private startRecording(): void {
		const selectedModelId = this.getSelectedModelId();
		log("startRecording()", { selectedModelId, sessionId: this.sessionId });
		this.transitionTo("checking_permission");
		this.waveform.primeStartup();

		// The configured backend goes first. Live speech recognition used to win
		// unconditionally whenever the webview offered it, which meant the
		// operator's own speech to text command was never asked and never even
		// recorded: the two paths are exclusive, and this one returned early.
		// Live speech is now what answers when there is no backend to ask.
		log("calling tauriClient.voice.getModelStatus", { modelId: selectedModelId });
		void Effect.runPromise(
			tauriClient.voice.getModelStatus(selectedModelId).pipe(
				Effect.match({
					onSuccess: (modelInfo) => {
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
							void Effect.runPromise(
								tauriClient.voice.downloadModel(selectedModelId).pipe(
									Effect.match({
										onSuccess: () => {
											log("downloadModel: success");
											this.activeDownloadModelId = null;
											this.downloadPercent = 100;
											if (!this.shouldContinueFromPhase("downloading_model", "downloadModel")) {
												return;
											}
											this.loadModelAndRecord(selectedModelId);
										},
										onFailure: (err: AppError) => {
											log("downloadModel: FAILED", { error: err.message });
											this.activeDownloadModelId = null;
											this.setError(resolveVoiceFailureMessage(err, "Model download failed"));
										},
									})
								)
							);
						} else if (modelInfo.is_loaded) {
							log("getModelStatus: model already loaded, starting recording immediately");
							if (
								!this.shouldContinueFromPhase("checking_permission", "getModelStatus.is_loaded")
							) {
								return;
							}
							this.beginRecording();
						} else {
							this.loadModelAndRecord(selectedModelId);
						}
					},
					onFailure: (err: AppError) => {
						log("getModelStatus: FAILED", { error: err.message });
						this.fallBackToLiveSpeech(err, "Failed to check model status");
					},
				})
			)
		);
	}

	private loadModelAndRecord(modelId: string): void {
		log("loadModelAndRecord()", { modelId, phase: this.phase });

		this.transitionTo("loading_model");
		this.isLoadingModel = true;

		log("calling tauriClient.voice.loadModel", { modelId });
		const t0 = performance.now();
		void Effect.runPromise(
			tauriClient.voice.loadModel(modelId).pipe(
				Effect.match({
					onSuccess: () => {
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
					onFailure: (err: AppError) => {
						log("loadModel: FAILED", { error: err.message });
						this.isLoadingModel = false;
						this.fallBackToLiveSpeech(err, "Failed to load model");
					},
				})
			)
		);
	}

	private beginRecording(): void {
		log("calling tauriClient.voice.startRecording", { sessionId: this.sessionId });
		void Effect.runPromise(
			tauriClient.voice.startRecording(this.sessionId).pipe(
				Effect.match({
					onSuccess: () => {
						log("startRecording: success");
						this.transitionTo("recording");
					},
					onFailure: (err: AppError) => {
						log("startRecording: FAILED", { error: err.message });
						this.setError(resolveVoiceFailureMessage(err, "Failed to start recording"));
					},
				})
			)
		);
	}

	private finishTranscription(text: string): void {
		this.clearWatchdog();
		const trimmed = text.trim();
		if (trimmed.length > 0) {
			this.onTranscriptionReady?.(trimmed);
		} else {
			toast.info("No speech detected");
		}
		this.transitionTo("complete");
		this.transitionTo("idle");
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
				this.setError("Transcription timed out");
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

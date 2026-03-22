import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "svelte-sonner";

import * as m from "$lib/paraglide/messages.js";
import type {
	AmplitudePayload,
	RecordingErrorPayload,
	TranscriptionCompletePayload,
	TranscriptionErrorPayload,
	VoiceModelDownloadProgress,
	VoiceInputPhase,
} from "../../../types/voice-input.js";
import { tauriClient } from "../../../../utils/tauri-client.js";
import type { AppError } from "../../../errors/app-error.js";
import { canCancelVoiceInteraction, shouldShowVoiceOverlay } from "../logic/voice-ui-state.js";
import { transition } from "./voice-transitions.js";
import { WaveformState } from "./waveform-state.svelte.js";

const ERROR_RESET_DELAY_MS = 3000;
const TRANSCRIBING_WATCHDOG_MS = 30_000;

export class VoiceInputState {
	static readonly PRESS_AND_HOLD_THRESHOLD_MS = 500;

	/** Current state machine phase */
	phase = $state<VoiceInputPhase>("idle");

	/** Waveform visualization state (separate class for performance) */
	readonly waveform = new WaveformState();

	/** Model download progress percentage 0-100 (set during downloading_model phase) */
	downloadPercent = $state<number>(0);

	/** Error message (set on error phase) */
	errorMessage = $state<string | null>(null);

	/** Whether recording was started via press-and-hold (vs click-to-toggle) */
	isPressAndHold = $state(false);

	/** Derived: is any voice UI active (not idle) */
	readonly isActive = $derived(this.phase !== "idle");

	/** Derived: show waveform overlay (recording or transcribing) */
	readonly showOverlay = $derived(shouldShowVoiceOverlay(this.phase));

	private readonly unlisteners: UnlistenFn[] = [];
	private pressTimer: ReturnType<typeof setTimeout> | null = null;
	private errorResetTimer: ReturnType<typeof setTimeout> | null = null;
	private transcribingWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

	private readonly sessionId: string;
	private readonly onTranscriptionReady: ((text: string) => void) | null;
	private readonly getSelectedLanguage: () => string;
	private readonly getSelectedModelId: () => string;

	constructor(options: {
		sessionId: string;
		onTranscriptionReady?: (text: string) => void;
		getSelectedLanguage?: () => string;
		getSelectedModelId?: () => string;
	}) {
		this.sessionId = options.sessionId;
		this.onTranscriptionReady = options.onTranscriptionReady ?? null;
		this.getSelectedLanguage = options.getSelectedLanguage ?? (() => "auto");
		this.getSelectedModelId = options.getSelectedModelId ?? (() => "small.en");
	}

	/** Register Tauri event listeners. Call once from onMount. */
	async registerListeners(): Promise<void> {
		const [amplitudeUnlisten, recErrUnlisten, transcCompleteUnlisten, transcErrUnlisten, dlProgressUnlisten] =
			await Promise.all([
				listen<AmplitudePayload>("voice://amplitude", (event) => {
					if (event.payload.session_id !== this.sessionId) return;
					if (this.phase !== "recording") return;
					this.waveform.pushBatch(event.payload.values);
				}),
				listen<RecordingErrorPayload>("voice://recording_error", (event) => {
					if (event.payload.session_id !== this.sessionId) return;
					this.setError(event.payload.message);
				}),
				listen<TranscriptionCompletePayload>("voice://transcription_complete", (event) => {
					if (event.payload.session_id !== this.sessionId) return;
					this.clearWatchdog();
					const text = event.payload.text.trim();
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
					if (event.payload.session_id !== this.sessionId) return;
					this.clearWatchdog();
					this.setError(event.payload.message);
				}),
				listen<VoiceModelDownloadProgress>("voice://model_download_progress", (event) => {
					this.downloadPercent = event.payload.percent;
				}),
			]);

		this.unlisteners.push(amplitudeUnlisten, recErrUnlisten, transcCompleteUnlisten, transcErrUnlisten, dlProgressUnlisten);
	}

	/** Unregister listeners and cancel any timers. Call from onDestroy. */
	dispose(): void {
		for (const unlisten of this.unlisteners) {
			unlisten();
		}
		this.unlisteners.length = 0;
		this.clearPressTimer();
		this.clearWatchdog();
		if (this.errorResetTimer !== null) {
			clearTimeout(this.errorResetTimer);
			this.errorResetTimer = null;
		}
		// Best-effort cancel if in-flight
		if (canCancelVoiceInteraction(this.phase)) {
			tauriClient.voice.cancelRecording(this.sessionId);
		}
	}

	// ── Press-and-hold interaction ───────────────────────────────────────────────

	/** Called on pointerdown on the mic button. */
	onMicPointerDown(event: PointerEvent): void {
		if (this.phase !== "idle") return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		this.clearPressTimer();
		this.pressTimer = setTimeout(() => {
			this.pressTimer = null;
			this.isPressAndHold = true;
			this.startRecording();
		}, VoiceInputState.PRESS_AND_HOLD_THRESHOLD_MS);
	}

	/** Called on pointerup on the mic button. */
	onMicPointerUp(): void {
		if (this.pressTimer !== null) {
			// Released before threshold → toggle click
			this.clearPressTimer();
			if (this.phase === "idle") {
				this.isPressAndHold = false;
				this.startRecording();
			} else if (this.phase === "recording") {
				this.stopRecording();
			}
		} else if (this.isPressAndHold && this.phase === "recording") {
			// Released after threshold → end hold
			this.stopRecording();
		}
	}

	/** Called on pointercancel (OS gesture) to prevent stranding. */
	onMicPointerCancel(): void {
		this.clearPressTimer();
		if (this.phase === "recording") {
			tauriClient.voice.cancelRecording(this.sessionId);
			this.waveform.reset();
			this.transitionTo("cancelled");
			this.transitionTo("idle");
		}
	}

	/** Manual stop (called from overlay Stop button or keyboard). */
	stopRecording(): void {
		if (this.phase !== "recording") return;
		this.waveform.reset();
		const selectedLanguage = this.getSelectedLanguage();
		const language = selectedLanguage === "auto" ? null : selectedLanguage;
		tauriClient.voice.stopRecording(this.sessionId, language).match(
			() => {
				// Transcription result will arrive via event
				this.transitionTo("transcribing");
				this.startWatchdog();
			},
			(err: AppError) => {
				this.setError(err.message ?? "Failed to stop recording");
			},
		);
	}

	/** Cancel recording (Escape / Cancel button). */
	cancelRecording(): void {
		if (!canCancelVoiceInteraction(this.phase)) return;
		this.clearWatchdog();
		tauriClient.voice.cancelRecording(this.sessionId);
		this.waveform.reset();
		this.transitionTo("cancelled");
		this.transitionTo("idle");
	}

	dismissError(): void {
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
		this.transitionTo("checking_permission");

		tauriClient.voice.getModelStatus(selectedModelId).match(
			(modelInfo: { is_downloaded: boolean }) => {
				if (!modelInfo.is_downloaded) {
					this.transitionTo("downloading_model");
					this.downloadPercent = 0;
					tauriClient.voice.downloadModel(selectedModelId).match(
						() => {
							this.loadModelAndRecord(selectedModelId);
						},
						(err: AppError) => {
							this.setError(err.message ?? "Model download failed");
						},
					);
				} else {
					this.loadModelAndRecord(selectedModelId);
				}
			},
			(err: AppError) => {
				this.setError(err.message ?? "Failed to check model status");
			},
		);
	}

	private loadModelAndRecord(modelId: string): void {
		tauriClient.voice.loadModel(modelId).match(
			() => {
				tauriClient.voice.startRecording(this.sessionId).match(
					() => {
						this.transitionTo("recording");
					},
					(err: AppError) => {
						this.setError(err.message ?? "Failed to start recording");
					},
				);
			},
			(err: AppError) => {
				this.setError(err.message ?? "Failed to load model");
			},
		);
	}

	private transitionTo(next: VoiceInputPhase): void {
		const result = transition(this.phase, next);
		if (result !== null) {
			this.phase = result;
		}
	}

	private setError(message: string): void {
		this.errorMessage = message;
		this.transitionTo("error");
		if (this.errorResetTimer !== null) clearTimeout(this.errorResetTimer);
		this.errorResetTimer = setTimeout(() => {
			this.errorResetTimer = null;
			this.errorMessage = null;
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
			this.transcribingWatchdogTimer = null;
			if (this.phase === "transcribing") {
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
}

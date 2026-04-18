/** Voice phases for toolbar mic / overlay — mirrors desktop voice-input phase union. */
export type AgentInputToolbarVoicePhase =
	| "idle"
	| "checking_permission"
	| "downloading_model"
	| "loading_model"
	| "recording"
	| "transcribing"
	| "complete"
	| "cancelled"
	| "error";

/** Minimal voice surface for toolbar mic controls (host maps VoiceInputState → this). */
export interface AgentComposerToolbarVoiceBinding {
	phase: AgentInputToolbarVoicePhase;
	recordingElapsedLabel: string | null;
	downloadPercent: number;
	onMicPointerDown: (event: PointerEvent) => void;
	onMicPointerUp: () => void;
	onMicPointerCancel: () => void;
	dismissError: () => void;
}

export type MicButtonVisualState = "mic" | "download_progress" | "spinner" | "stop";

export function getMicButtonVisualState(phase: AgentInputToolbarVoicePhase): MicButtonVisualState {
	if (phase === "downloading_model") {
		return "download_progress";
	}

	if (phase === "loading_model" || phase === "transcribing") {
		return "spinner";
	}

	if (phase === "checking_permission" || phase === "recording") {
		return "stop";
	}

	return "mic";
}

export function canStartVoiceInteraction(phase: AgentInputToolbarVoicePhase, isSending: boolean): boolean {
	if (isSending) {
		return false;
	}

	return phase === "idle";
}

export function canCancelVoiceInteraction(phase: AgentInputToolbarVoicePhase): boolean {
	return (
		phase === "checking_permission" ||
		phase === "downloading_model" ||
		phase === "loading_model" ||
		phase === "recording"
	);
}

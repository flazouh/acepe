import type { VoiceInputPhase } from "$lib/acp/types/voice-input.js";

export type MicButtonVisualState = "mic" | "download_progress" | "spinner" | "stop";

export function getMicButtonVisualState(phase: VoiceInputPhase): MicButtonVisualState {
	if (phase === "downloading_model") {
		return "download_progress";
	}

	if (
		phase === "loading_model" ||
		phase === "transcribing"
	) {
		return "spinner";
	}

	if (phase === "checking_permission" || phase === "recording") {
		return "stop";
	}

	return "mic";
}

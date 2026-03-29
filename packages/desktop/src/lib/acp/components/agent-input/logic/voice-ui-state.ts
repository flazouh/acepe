import type { VoiceInputPhase } from "$lib/acp/types/voice-input.js";

export function canStartVoiceInteraction(phase: VoiceInputPhase, isSending: boolean): boolean {
	if (isSending) {
		return false;
	}

	return phase === "idle";
}

export function canCancelVoiceInteraction(phase: VoiceInputPhase): boolean {
	return (
		phase === "checking_permission" ||
		phase === "downloading_model" ||
		phase === "loading_model" ||
		phase === "recording"
	);
}

export function shouldShowVoiceOverlay(phase: VoiceInputPhase): boolean {
	return phase === "checking_permission" || phase === "recording" || phase === "error";
}

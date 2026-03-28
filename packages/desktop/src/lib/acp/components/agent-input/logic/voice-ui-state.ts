import type { VoiceInputPhase } from "$lib/acp/types/voice-input.js";

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

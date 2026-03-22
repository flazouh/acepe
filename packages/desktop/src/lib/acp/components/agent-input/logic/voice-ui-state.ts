import type { VoiceInputPhase } from "$lib/acp/types/voice-input.js";

export function canCancelVoiceInteraction(phase: VoiceInputPhase): boolean {
	return phase === "recording" || phase === "transcribing";
}

export function shouldShowVoiceOverlay(phase: VoiceInputPhase): boolean {
	return (
		phase === "recording" ||
		phase === "transcribing" ||
		phase === "downloading_model" ||
		phase === "error"
	);
}
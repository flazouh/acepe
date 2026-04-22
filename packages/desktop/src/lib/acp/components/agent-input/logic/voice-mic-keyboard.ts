import type { VoiceInputState } from "../state/voice-input-state.svelte.js";
import { canCancelVoiceInteraction } from "./voice-ui-state.js";

export function handleVoiceMicKeyDown(
	event: KeyboardEvent,
	currentVoiceState: VoiceInputState
): void {
	if (event.key === " " || event.key === "Enter") {
		event.preventDefault();
		if (currentVoiceState.phase === "idle") {
			currentVoiceState.onKeyboardHoldStart();
		} else if (currentVoiceState.phase === "recording") {
			currentVoiceState.onKeyboardHoldEnd();
		}
	}
	if (event.key === "Escape" && canCancelVoiceInteraction(currentVoiceState.phase)) {
		currentVoiceState.cancelRecording();
	}
}

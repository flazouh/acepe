import type { AgentComposerToolbarVoiceBinding } from "@acepe/ui/agent-panel";

import type { VoiceInputState } from "../state/voice-input-state.svelte.js";

export function toVoiceToolbarBinding(
	voice: VoiceInputState | null
): AgentComposerToolbarVoiceBinding | null {
	if (!voice) {
		return null;
	}
	return {
		phase: voice.phase,
		recordingElapsedLabel: voice.recordingElapsedLabel,
		downloadPercent: voice.downloadPercent,
		onMicPointerDown: (e: PointerEvent) => {
			voice.onMicPointerDown(e);
		},
		onMicPointerUp: () => {
			voice.onMicPointerUp();
		},
		onMicPointerCancel: () => {
			voice.onMicPointerCancel();
		},
		dismissError: () => {
			voice.dismissError();
		},
	};
}

import type { VoiceInputPhase } from "../../../types/voice-input.js";

/** Voice mic tooltip strings supplied by the host component. */
export type VoiceMicTooltipLabels = {
	downloadingModel: string;
	loadingModel: string;
	checkingPermission: string;
	transcribing: string;
	stopRecording: string;
	startRecording: string;
};

export function resolveVoiceMicTooltip(
	phase: VoiceInputPhase,
	labels: VoiceMicTooltipLabels
): string {
	if (phase === "downloading_model") {
		return labels.downloadingModel;
	}
	if (phase === "loading_model") {
		return labels.loadingModel;
	}
	if (phase === "checking_permission") {
		return labels.checkingPermission;
	}
	if (phase === "transcribing") {
		return labels.transcribing;
	}
	if (phase === "recording") {
		return labels.stopRecording;
	}
	return labels.startRecording;
}

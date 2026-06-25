import {
	canCancelVoiceInteraction,
	canStartVoiceInteraction,
	type AgentComposerToolbarVoiceBinding,
} from "./agent-input-toolbar-voice.js";

export function isVoiceRecordingUi(
	voiceState: AgentComposerToolbarVoiceBinding | null
): boolean {
	return (
		voiceState !== null &&
		(voiceState.phase === "checking_permission" || voiceState.phase === "recording")
	);
}

export function isVoiceActive(
	voiceState: AgentComposerToolbarVoiceBinding | null
): boolean {
	return (
		voiceState !== null &&
		voiceState.phase !== "idle" &&
		voiceState.phase !== "error"
	);
}

export function shouldShowVoiceRecordingBar(
	voiceState: AgentComposerToolbarVoiceBinding | null
): boolean {
	return voiceState !== null && isVoiceRecordingUi(voiceState);
}

export function shouldShowVoiceErrorDismiss(
	input: {
		voiceState: AgentComposerToolbarVoiceBinding | null;
		voiceEnabled: boolean;
	}
): boolean {
	return (
		input.voiceState !== null &&
		input.voiceEnabled &&
		input.voiceState.phase === "error"
	);
}

export function shouldShowVoiceControls(input: {
	voiceState: AgentComposerToolbarVoiceBinding | null;
	voiceEnabled: boolean;
}): boolean {
	return input.voiceState !== null && input.voiceEnabled;
}

export function isToolbarLeftSideDisabled(input: {
	isRecordingUi: boolean;
	selectorsDisabledByComposer: boolean;
}): boolean {
	return input.isRecordingUi || input.selectorsDisabledByComposer;
}

export function isMicButtonDisabled(input: {
	voiceState: AgentComposerToolbarVoiceBinding;
	composerIsDispatching: boolean;
}): boolean {
	return (
		!canStartVoiceInteraction(input.voiceState.phase, input.composerIsDispatching) &&
		!canCancelVoiceInteraction(input.voiceState.phase)
	);
}

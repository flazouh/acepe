import { describe, expect, test } from "bun:test";
import {
	isMicButtonDisabled,
	isToolbarLeftSideDisabled,
	isVoiceActive,
	isVoiceRecordingUi,
	shouldShowVoiceControls,
	shouldShowVoiceErrorDismiss,
	shouldShowVoiceRecordingBar,
} from "./agent-input-composer-toolbar-state.js";
import type {
	AgentComposerToolbarVoiceBinding,
	AgentInputToolbarVoicePhase,
} from "./agent-input-toolbar-voice.js";

function makeVoiceState(
	phase: AgentInputToolbarVoicePhase
): AgentComposerToolbarVoiceBinding {
	return {
		phase,
		recordingElapsedLabel: null,
		downloadPercent: 0,
		onMicPointerDown: () => {},
		onMicPointerUp: () => {},
		onMicPointerCancel: () => {},
		dismissError: () => {},
	};
}

describe("agent input composer toolbar state", () => {
	test("detects recording UI phases", () => {
		expect(isVoiceRecordingUi(makeVoiceState("checking_permission"))).toBe(true);
		expect(isVoiceRecordingUi(makeVoiceState("recording"))).toBe(true);
		expect(isVoiceRecordingUi(makeVoiceState("loading_model"))).toBe(false);
		expect(isVoiceRecordingUi(null)).toBe(false);
	});

	test("detects active voice phases", () => {
		expect(isVoiceActive(makeVoiceState("idle"))).toBe(false);
		expect(isVoiceActive(makeVoiceState("error"))).toBe(false);
		expect(isVoiceActive(makeVoiceState("recording"))).toBe(true);
		expect(isVoiceActive(makeVoiceState("transcribing"))).toBe(true);
		expect(isVoiceActive(null)).toBe(false);
	});

	test("selects visible voice regions", () => {
		const recording = makeVoiceState("recording");
		const error = makeVoiceState("error");

		expect(shouldShowVoiceRecordingBar(recording)).toBe(true);
		expect(shouldShowVoiceRecordingBar(error)).toBe(false);
		expect(
			shouldShowVoiceControls({
				voiceState: recording,
				voiceEnabled: true,
				isRecordingUi: true,
			})
		).toBe(false);
		expect(
			shouldShowVoiceControls({
				voiceState: error,
				voiceEnabled: true,
				isRecordingUi: false,
			})
		).toBe(true);
		expect(shouldShowVoiceErrorDismiss({ voiceState: error, voiceEnabled: true })).toBe(
			true
		);
		expect(shouldShowVoiceErrorDismiss({ voiceState: error, voiceEnabled: false })).toBe(
			false
		);
	});

	test("disables left side while recording or composer disabled", () => {
		expect(
			isToolbarLeftSideDisabled({
				isRecordingUi: false,
				selectorsDisabledByComposer: false,
			})
		).toBe(false);
		expect(
			isToolbarLeftSideDisabled({
				isRecordingUi: true,
				selectorsDisabledByComposer: false,
			})
		).toBe(true);
		expect(
			isToolbarLeftSideDisabled({
				isRecordingUi: false,
				selectorsDisabledByComposer: true,
			})
		).toBe(true);
	});

	test("disables mic only when it cannot start or cancel", () => {
		expect(
			isMicButtonDisabled({
				voiceState: makeVoiceState("idle"),
				composerIsDispatching: false,
			})
		).toBe(false);
		expect(
			isMicButtonDisabled({
				voiceState: makeVoiceState("idle"),
				composerIsDispatching: true,
			})
		).toBe(true);
		expect(
			isMicButtonDisabled({
				voiceState: makeVoiceState("recording"),
				composerIsDispatching: true,
			})
		).toBe(false);
		expect(
			isMicButtonDisabled({
				voiceState: makeVoiceState("transcribing"),
				composerIsDispatching: false,
			})
		).toBe(true);
	});
});

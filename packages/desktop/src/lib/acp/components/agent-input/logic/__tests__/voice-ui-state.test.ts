import { describe, expect, it } from "vitest";
import { canCancelVoiceInteraction, shouldShowVoiceOverlay } from "../voice-ui-state.js";
import type { VoiceInputPhase } from "../../../../types/voice-input.js";

describe("voice-ui-state", () => {
	const ALL_PHASES: VoiceInputPhase[] = [
		"idle", "checking_permission", "downloading_model", "loading_model",
		"recording", "transcribing", "complete", "cancelled", "error",
	];

	const CANCELLABLE_PHASES: VoiceInputPhase[] = [
		"checking_permission", "downloading_model", "loading_model", "recording", "transcribing",
	];

	const OVERLAY_PHASES: VoiceInputPhase[] = [
		"transcribing", "error",
	];

	describe("canCancelVoiceInteraction", () => {
		it.each(CANCELLABLE_PHASES)("returns true for %s", (phase) => {
			expect(canCancelVoiceInteraction(phase)).toBe(true);
		});

		it.each(
			ALL_PHASES.filter((p) => !CANCELLABLE_PHASES.includes(p)),
		)("returns false for %s", (phase) => {
			expect(canCancelVoiceInteraction(phase)).toBe(false);
		});
	});

	describe("shouldShowVoiceOverlay", () => {
		it.each(OVERLAY_PHASES)("returns true for %s", (phase) => {
			expect(shouldShowVoiceOverlay(phase)).toBe(true);
		});

		it.each(
			ALL_PHASES.filter((p) => !OVERLAY_PHASES.includes(p)),
		)("returns false for %s", (phase) => {
			expect(shouldShowVoiceOverlay(phase)).toBe(false);
		});
	});
});

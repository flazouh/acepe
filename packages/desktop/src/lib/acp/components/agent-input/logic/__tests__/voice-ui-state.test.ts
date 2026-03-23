import { describe, expect, it } from "vitest";
import { canCancelVoiceInteraction, shouldShowVoiceOverlay } from "../voice-ui-state.js";
import type { VoiceInputPhase } from "../../../../types/voice-input.js";

describe("voice-ui-state", () => {
	const ALL_PHASES: VoiceInputPhase[] = [
		"idle", "checking_permission", "downloading_model",
		"recording", "transcribing", "complete", "cancelled", "error",
	];

	describe("canCancelVoiceInteraction", () => {
		it("returns true for recording", () => {
			expect(canCancelVoiceInteraction("recording")).toBe(true);
		});

		it("returns true for transcribing", () => {
			expect(canCancelVoiceInteraction("transcribing")).toBe(true);
		});

		it.each(
			ALL_PHASES.filter((p) => p !== "recording" && p !== "transcribing"),
		)("returns false for %s", (phase) => {
			expect(canCancelVoiceInteraction(phase)).toBe(false);
		});
	});

	describe("shouldShowVoiceOverlay", () => {
		it("returns true for recording", () => {
			expect(shouldShowVoiceOverlay("recording")).toBe(true);
		});

		it("returns true for transcribing", () => {
			expect(shouldShowVoiceOverlay("transcribing")).toBe(true);
		});

		it("returns true for downloading_model", () => {
			expect(shouldShowVoiceOverlay("downloading_model")).toBe(true);
		});

		it("returns true for error", () => {
			expect(shouldShowVoiceOverlay("error")).toBe(true);
		});

		it.each(
			ALL_PHASES.filter((p) => !["recording", "transcribing", "downloading_model", "error"].includes(p)),
		)("returns false for %s", (phase) => {
			expect(shouldShowVoiceOverlay(phase)).toBe(false);
		});
	});
});

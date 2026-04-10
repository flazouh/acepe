import { describe, expect, it } from "vitest";
import type { VoiceInputPhase } from "../../../../types/voice-input.js";
import {
	canCancelVoiceInteraction,
	canStartVoiceInteraction,
	shouldShowVoiceOverlay,
} from "../voice-ui-state.js";

describe("voice-ui-state", () => {
	const ALL_PHASES: VoiceInputPhase[] = [
		"idle",
		"checking_permission",
		"downloading_model",
		"loading_model",
		"recording",
		"transcribing",
		"complete",
		"cancelled",
		"error",
	];

	const CANCELLABLE_PHASES: VoiceInputPhase[] = [
		"checking_permission",
		"downloading_model",
		"loading_model",
		"recording",
	];

	const OVERLAY_PHASES: VoiceInputPhase[] = ["checking_permission", "recording", "error"];

	describe("canCancelVoiceInteraction", () => {
		it.each(CANCELLABLE_PHASES)("returns true for %s", (phase) => {
			expect(canCancelVoiceInteraction(phase)).toBe(true);
		});

		it.each(
			ALL_PHASES.filter((p) => !CANCELLABLE_PHASES.includes(p))
		)("returns false for %s", (phase) => {
			expect(canCancelVoiceInteraction(phase)).toBe(false);
		});
	});

	describe("canStartVoiceInteraction", () => {
		it("allows idle voice input while agent is streaming elsewhere", () => {
			expect(canStartVoiceInteraction("idle", false)).toBe(true);
		});

		it("blocks voice input while the input is currently sending", () => {
			expect(canStartVoiceInteraction("idle", true)).toBe(false);
		});

		it.each(
			ALL_PHASES.filter((phase) => phase !== "idle")
		)("blocks voice start when phase is %s", (phase) => {
			expect(canStartVoiceInteraction(phase, false)).toBe(false);
		});
	});

	describe("shouldShowVoiceOverlay", () => {
		it.each(OVERLAY_PHASES)("returns true for %s", (phase) => {
			expect(shouldShowVoiceOverlay(phase)).toBe(true);
		});

		it.each(
			ALL_PHASES.filter((p) => !OVERLAY_PHASES.includes(p))
		)("returns false for %s", (phase) => {
			expect(shouldShowVoiceOverlay(phase)).toBe(false);
		});
	});
});

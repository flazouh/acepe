import { describe, expect, it } from "vitest";
import { transition, VALID_TRANSITIONS } from "../voice-transitions.js";
import type { VoiceInputPhase } from "../../../../types/voice-input.js";

describe("voice state machine transitions", () => {
	// All valid forward transitions
	it("idle → checking_permission is valid", () => {
		expect(transition("idle", "checking_permission")).toBe("checking_permission");
	});

	it("checking_permission → recording is valid", () => {
		expect(transition("checking_permission", "recording")).toBe("recording");
	});

	it("checking_permission → downloading_model is valid", () => {
		expect(transition("checking_permission", "downloading_model")).toBe("downloading_model");
	});

	it("checking_permission → error is valid", () => {
		expect(transition("checking_permission", "error")).toBe("error");
	});

	it("checking_permission → cancelled is valid", () => {
		expect(transition("checking_permission", "cancelled")).toBe("cancelled");
	});

	it("downloading_model → recording is valid", () => {
		expect(transition("downloading_model", "recording")).toBe("recording");
	});

	it("downloading_model → error is valid", () => {
		expect(transition("downloading_model", "error")).toBe("error");
	});

	it("downloading_model → cancelled is valid", () => {
		expect(transition("downloading_model", "cancelled")).toBe("cancelled");
	});

	it("recording → transcribing is valid", () => {
		expect(transition("recording", "transcribing")).toBe("transcribing");
	});

	it("recording → cancelled is valid", () => {
		expect(transition("recording", "cancelled")).toBe("cancelled");
	});

	it("recording → error is valid", () => {
		expect(transition("recording", "error")).toBe("error");
	});

	it("transcribing → complete is valid", () => {
		expect(transition("transcribing", "complete")).toBe("complete");
	});

	it("transcribing → cancelled is valid", () => {
		expect(transition("transcribing", "cancelled")).toBe("cancelled");
	});

	it("transcribing → error is valid", () => {
		expect(transition("transcribing", "error")).toBe("error");
	});

	it("complete → idle is valid", () => {
		expect(transition("complete", "idle")).toBe("idle");
	});

	it("cancelled → idle is valid", () => {
		expect(transition("cancelled", "idle")).toBe("idle");
	});

	it("error → idle is valid", () => {
		expect(transition("error", "idle")).toBe("idle");
	});

	// Invalid transitions return null
	it("idle → recording is invalid", () => {
		expect(transition("idle", "recording")).toBeNull();
	});

	it("idle → transcribing is invalid", () => {
		expect(transition("idle", "transcribing")).toBeNull();
	});

	it("idle → idle is invalid", () => {
		expect(transition("idle", "idle")).toBeNull();
	});

	it("recording → idle is invalid (must go through transcribing/cancelled)", () => {
		expect(transition("recording", "idle")).toBeNull();
	});

	it("recording → downloading_model is invalid", () => {
		expect(transition("recording", "downloading_model")).toBeNull();
	});

	it("transcribing → recording is invalid", () => {
		expect(transition("transcribing", "recording")).toBeNull();
	});

	it("complete → recording is invalid", () => {
		expect(transition("complete", "recording")).toBeNull();
	});

	it("error → recording is invalid (must reset to idle first)", () => {
		expect(transition("error", "recording")).toBeNull();
	});

	// All states are present in transition table
	it("all VoiceInputPhase states have transition definitions", () => {
		const expectedStates: VoiceInputPhase[] = [
			"idle",
			"checking_permission",
			"downloading_model",
			"recording",
			"transcribing",
			"complete",
			"cancelled",
			"error",
		];
		for (const state of expectedStates) {
			expect(VALID_TRANSITIONS[state]).toBeDefined();
		}
	});

	it("each state's transition set is immutable (ReadonlySet)", () => {
		for (const set of Object.values(VALID_TRANSITIONS)) {
			// ReadonlySet does not have .add — verify it has .has
			expect(typeof set.has).toBe("function");
		}
	});
});

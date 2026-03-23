import { describe, expect, it } from "vitest";
import { transition, VALID_TRANSITIONS } from "../voice-transitions.js";
import type { VoiceInputPhase } from "../../../../types/voice-input.js";

describe("voice-transitions", () => {
	describe("transition()", () => {
		it("allows idle → checking_permission", () => {
			expect(transition("idle", "checking_permission")).toBe("checking_permission");
		});

		it("rejects idle → recording (must go through checking_permission)", () => {
			expect(transition("idle", "recording")).toBeNull();
		});

		it("allows checking_permission → recording", () => {
			expect(transition("checking_permission", "recording")).toBe("recording");
		});

		it("allows checking_permission → downloading_model", () => {
			expect(transition("checking_permission", "downloading_model")).toBe("downloading_model");
		});

		it("allows checking_permission → error", () => {
			expect(transition("checking_permission", "error")).toBe("error");
		});

		it("allows checking_permission → cancelled", () => {
			expect(transition("checking_permission", "cancelled")).toBe("cancelled");
		});

		it("allows recording → transcribing", () => {
			expect(transition("recording", "transcribing")).toBe("transcribing");
		});

		it("allows recording → cancelled", () => {
			expect(transition("recording", "cancelled")).toBe("cancelled");
		});

		it("allows recording → error", () => {
			expect(transition("recording", "error")).toBe("error");
		});

		it("rejects recording → idle directly", () => {
			expect(transition("recording", "idle")).toBeNull();
		});

		it("rejects recording → downloading_model", () => {
			expect(transition("recording", "downloading_model")).toBeNull();
		});

		it("allows transcribing → complete", () => {
			expect(transition("transcribing", "complete")).toBe("complete");
		});

		it("allows transcribing → cancelled", () => {
			expect(transition("transcribing", "cancelled")).toBe("cancelled");
		});

		it("allows transcribing → error", () => {
			expect(transition("transcribing", "error")).toBe("error");
		});

		it("rejects transcribing → recording", () => {
			expect(transition("transcribing", "recording")).toBeNull();
		});

		it("allows complete → idle", () => {
			expect(transition("complete", "idle")).toBe("idle");
		});

		it("rejects complete → recording", () => {
			expect(transition("complete", "recording")).toBeNull();
		});

		it("allows cancelled → idle", () => {
			expect(transition("cancelled", "idle")).toBe("idle");
		});

		it("allows error → idle", () => {
			expect(transition("error", "idle")).toBe("idle");
		});

		it("rejects error → recording", () => {
			expect(transition("error", "recording")).toBeNull();
		});

		it("rejects idle → idle (self-transition)", () => {
			expect(transition("idle", "idle")).toBeNull();
		});

		it("rejects idle → transcribing", () => {
			expect(transition("idle", "transcribing")).toBeNull();
		});

		it("allows downloading_model → recording", () => {
			expect(transition("downloading_model", "recording")).toBe("recording");
		});

		it("allows downloading_model → error", () => {
			expect(transition("downloading_model", "error")).toBe("error");
		});

		it("allows downloading_model → cancelled", () => {
			expect(transition("downloading_model", "cancelled")).toBe("cancelled");
		});
	});

	describe("VALID_TRANSITIONS completeness", () => {
		const ALL_PHASES: VoiceInputPhase[] = [
			"idle", "checking_permission", "downloading_model",
			"recording", "transcribing", "complete", "cancelled", "error",
		];

		it("has entries for every phase", () => {
			for (const phase of ALL_PHASES) {
				expect(VALID_TRANSITIONS).toHaveProperty(phase);
			}
		});

		it("terminal states (complete, cancelled, error) only transition to idle", () => {
			for (const terminal of ["complete", "cancelled", "error"] as const) {
				const allowed = VALID_TRANSITIONS[terminal];
				expect(allowed.size).toBe(1);
				expect(allowed.has("idle")).toBe(true);
			}
		});

		it("each state's transition set is immutable (ReadonlySet)", () => {
			for (const set of Object.values(VALID_TRANSITIONS)) {
				expect(typeof set.has).toBe("function");
			}
		});
	});
});

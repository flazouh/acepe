import { describe, expect, it } from "vitest";
import type { StreamingReproPreset } from "../streaming-repro-controller";
import {
	applyStreamingReproTokenReveal,
	buildStreamingReproTokenRevealCss,
} from "../streaming-repro-token-reveal";

const PRESET: StreamingReproPreset = {
	id: "test",
	name: "Test preset",
	phases: [
		{
			id: "one",
			label: "One",
			assistantText: "one two",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "two",
			label: "Two",
			assistantText: "one two three four",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
		},
		{
			id: "instant",
			label: "Instant",
			assistantText: "instant mode",
			turnState: "Running",
			activityKind: "awaiting_model",
			activeStreamingTailRowId: "assistant-1",
			assistantStreaming: true,
			streamingAnimationMode: "instant",
		},
	],
};

describe("buildStreamingReproTokenRevealCss", () => {
	it("anchors the next phase to the previous visible word count", () => {
		expect(
			buildStreamingReproTokenRevealCss({
				preset: PRESET,
				phaseIndex: 1,
				phase: PRESET.phases[1]!,
				phaseElapsedMs: 16,
			})
		).toEqual({
			revealCount: 2,
			revealedCharCount: "one two three four".length,
			baselineMs: -16,
			tokStepMs: 0,
			tokFadeDurMs: 630,
			mode: "smooth",
		});
	});

	it("switches to instant mode for instant-animation phases", () => {
		expect(
			buildStreamingReproTokenRevealCss({
				preset: PRESET,
				phaseIndex: 2,
				phase: PRESET.phases[2]!,
				phaseElapsedMs: 0,
			})?.mode
		).toBe("instant");
	});

	it("keeps token timing after streaming stops while reveal animations are still pending", () => {
		expect(
			buildStreamingReproTokenRevealCss({
				preset: PRESET,
				phaseIndex: 1,
				phase: {
					...PRESET.phases[1]!,
					assistantStreaming: false,
				},
				phaseElapsedMs: 0,
			})
		).toMatchObject({
			revealCount: 2,
			tokStepMs: 0,
			tokFadeDurMs: 630,
			mode: "smooth",
		});
	});

	it("drops token timing after the final reveal animation has settled", () => {
		expect(
			buildStreamingReproTokenRevealCss({
				preset: PRESET,
				phaseIndex: 1,
				phase: {
					...PRESET.phases[1]!,
					assistantStreaming: false,
				},
				phaseElapsedMs: 1_000,
			})
		).toBeUndefined();
	});
});

describe("applyStreamingReproTokenReveal", () => {
	it("adds tokenRevealCss to the active assistant entry only", () => {
		const entries = applyStreamingReproTokenReveal({
			entries: [
				{ id: "user-1", type: "user", text: "hello" },
				{
					id: "assistant-1",
					type: "assistant",
					markdown: "one two three four",
				},
			],
			preset: PRESET,
			phaseIndex: 1,
			phase: PRESET.phases[1]!,
			phaseElapsedMs: 16,
		});

		expect(entries[0]).toEqual({ id: "user-1", type: "user", text: "hello" });
		expect(entries[1]).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			tokenRevealCss: {
				revealCount: 2,
				revealedCharCount: "one two three four".length,
				baselineMs: -16,
			},
		});
	});
});

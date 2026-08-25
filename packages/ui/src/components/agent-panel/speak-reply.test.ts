import { describe, expect, it } from "bun:test";

import { toggleSpokenReply, type SpokenReplySynth } from "./speak-reply.js";

function createFakeSynth(initialSpeaking = false): SpokenReplySynth & {
	spoken: string[];
	cancelled: number;
	setSpeaking: (next: boolean) => void;
} {
	let speaking = initialSpeaking;
	const spoken: string[] = [];
	let cancelled = 0;

	return {
		spoken,
		get cancelled() {
			return cancelled;
		},
		setSpeaking: (next) => {
			speaking = next;
		},
		speaking: () => speaking,
		cancel: () => {
			cancelled += 1;
			speaking = false;
		},
		speak: (text) => {
			spoken.push(text);
			speaking = true;
		},
	};
}

describe("toggleSpokenReply", () => {
	it("returns empty and does not speak whitespace", () => {
		const synth = createFakeSynth();
		const changes: boolean[] = [];

		expect(
			toggleSpokenReply("   ", synth, {
				onSpeakingChange: (next) => {
					changes.push(next);
				},
			})
		).toBe("empty");
		expect(synth.spoken).toEqual([]);
		expect(changes).toEqual([]);
	});

	it("speaks the prepared reply", () => {
		const synth = createFakeSynth();
		const changes: boolean[] = [];

		expect(
			toggleSpokenReply("  Hello,\nworld.  ", synth, {
				onSpeakingChange: (next) => {
					changes.push(next);
				},
			})
		).toBe("spoke");
		expect(synth.spoken).toEqual(["Hello, world."]);
		expect(changes).toEqual([true]);
	});

	it("stops speech when this reply is already speaking", () => {
		const synth = createFakeSynth(true);
		const changes: boolean[] = [];

		expect(
			toggleSpokenReply(
				"Hello",
				synth,
				{
					onSpeakingChange: (next) => {
						changes.push(next);
					},
				},
				true
			)
		).toBe("stopped");
		expect(synth.cancelled).toBe(1);
		expect(synth.spoken).toEqual([]);
		expect(changes).toEqual([false]);
	});

	it("replaces speech when a different reply starts", () => {
		const synth = createFakeSynth(true);
		const changes: boolean[] = [];

		expect(
			toggleSpokenReply(
				"Other reply",
				synth,
				{
					onSpeakingChange: (next) => {
						changes.push(next);
					},
				},
				false
			)
		).toBe("spoke");
		expect(synth.cancelled).toBe(1);
		expect(synth.spoken).toEqual(["Other reply"]);
		expect(changes).toEqual([true]);
	});
});

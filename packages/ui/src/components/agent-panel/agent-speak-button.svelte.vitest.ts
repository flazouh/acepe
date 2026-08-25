import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentSpeakButton from "./agent-speak-button.svelte";
import type { SpokenReplySynth } from "./speak-reply.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

function createFakeSynth(): SpokenReplySynth & { spoken: string[] } {
	let speaking = false;
	const spoken: string[] = [];

	return {
		spoken,
		speaking: () => speaking,
		cancel: () => {
			speaking = false;
		},
		speak: (text) => {
			spoken.push(text);
			speaking = true;
		},
	};
}

afterEach(() => {
	cleanup();
});

describe("AgentSpeakButton", () => {
	it("renders the volume icon for a speakable reply", () => {
		const view = render(AgentSpeakButton, {
			props: {
				text: "hello",
				synth: createFakeSynth(),
			},
		});

		const icon = view.getByTestId("agent-speak-button-icon");
		expect(icon.tagName.toLowerCase()).toBe("svg");
		expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon.innerHTML).not.toBe("");
	});

	it("speaks the reply when the trigger is clicked", async () => {
		const synth = createFakeSynth();
		const view = render(AgentSpeakButton, {
			props: {
				text: "Hello world",
				synth,
			},
		});

		const trigger = view.getByRole("button", { name: "Speak reply" });
		await fireEvent.click(trigger);

		expect(synth.spoken).toEqual(["Hello world"]);
		expect(view.getByRole("button", { name: "Stop speaking" })).toBeTruthy();
	});
});

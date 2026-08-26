import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import QaOverlay from "../qa-overlay.svelte";

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

afterEach(() => {
	cleanup();
});

const noop = () => undefined;

const baseProps = {
	scenarioName: "streaming-reply",
	scenarioDescription: "a user message and a bursty streamed reply",
	playback: "paused",
	cursor: 0,
	total: 8,
	lastEventType: null,
	rate: 1,
	rateOptions: [0, 1, 2],
	scenarios: [
		{ name: "streaming-reply", description: "", active: true },
		{ name: "tool-and-approval", description: "", active: false },
	],
	missingCalls: [],
	collapsed: false,
	onToggleCollapsed: noop,
	onPlay: noop,
	onPause: noop,
	onStep: noop,
	onSeek: noop,
	onRate: noop,
	onScenario: noop,
};

describe("QaOverlay", () => {
	it("publishes the playback facts as data attributes a QA script can read", () => {
		const view = render(QaOverlay, { props: { ...baseProps, cursor: 3, playback: "playing" } });
		const overlay = view.container.querySelector('[data-testid="qa-overlay"]');
		expect(overlay?.getAttribute("data-qa-scenario")).toBe("streaming-reply");
		expect(overlay?.getAttribute("data-qa-playback")).toBe("playing");
		expect(overlay?.getAttribute("data-qa-cursor")).toBe("3");
		expect(overlay?.getAttribute("data-qa-total")).toBe("8");
	});

	it("offers pause while playing and play while paused, never both", () => {
		const playing = render(QaOverlay, { props: { ...baseProps, playback: "playing" } });
		expect(playing.container.querySelector('[data-testid="qa-overlay-pause"]')).not.toBeNull();
		expect(playing.container.querySelector('[data-testid="qa-overlay-play"]')).toBeNull();
		cleanup();

		const paused = render(QaOverlay, { props: baseProps });
		expect(paused.container.querySelector('[data-testid="qa-overlay-play"]')).not.toBeNull();
		expect(paused.container.querySelector('[data-testid="qa-overlay-pause"]')).toBeNull();
	});

	it("stops offering play and step once the scenario has drained", () => {
		const view = render(QaOverlay, { props: { ...baseProps, cursor: 8 } });
		const play = view.container.querySelector('[data-testid="qa-overlay-play"]');
		const step = view.container.querySelector('[data-testid="qa-overlay-step"]');
		expect(play?.hasAttribute("disabled")).toBe(true);
		expect(step?.hasAttribute("disabled")).toBe(true);
	});

	it("steps when the step button is pressed", async () => {
		let steps = 0;
		const view = render(QaOverlay, {
			props: {
				...baseProps,
				cursor: 2,
				onStep: () => {
					steps = steps + 1;
				},
			},
		});
		const step = view.container.querySelector('[data-testid="qa-overlay-step"]');
		(step as HTMLButtonElement).click();
		expect(steps).toBe(1);
	});

	it("marks the active rate so the current speed is readable", () => {
		const view = render(QaOverlay, { props: { ...baseProps, rate: 2 } });
		const active = view.container.querySelector('[data-qa-rate-active="true"]');
		expect(active?.getAttribute("data-qa-rate")).toBe("2");
	});

	it("shows what the recording is missing instead of hiding a failed call", () => {
		const clean = render(QaOverlay, { props: baseProps });
		expect(clean.container.querySelector('[data-testid="qa-overlay-missing"]')).toBeNull();
		cleanup();

		const missing = render(QaOverlay, {
			props: { ...baseProps, missingCalls: ['gitCall {"kind":"panelStatus"}'] },
		});
		const panel = missing.container.querySelector('[data-testid="qa-overlay-missing"]');
		expect(panel?.textContent).toContain("panelStatus");
	});

	it("collapses to the header so it can get out of the way", () => {
		const view = render(QaOverlay, { props: { ...baseProps, collapsed: true } });
		expect(view.container.querySelector('[data-testid="qa-overlay-name"]')).not.toBeNull();
		expect(view.container.querySelector('[data-testid="qa-overlay-step"]')).toBeNull();
	});
});

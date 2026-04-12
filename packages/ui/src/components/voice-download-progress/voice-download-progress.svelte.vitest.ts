import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import VoiceDownloadProgress from "./voice-download-progress.svelte";

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

describe("VoiceDownloadProgress", () => {
	it("can hide the percent label while preserving segmented progress", () => {
		const { container } = render(VoiceDownloadProgress, {
			ariaLabel: "Downloading model",
			compact: true,
			label: "",
			percent: 49,
			segmentCount: 20,
			showPercent: false,
		});

		expect(container.querySelectorAll(".voice-download-segment")).toHaveLength(20);
		expect(container.textContent).not.toContain("49%");
	});

	it("renders download progress as vertical bars", () => {
		const { container } = render(VoiceDownloadProgress, {
			ariaLabel: "Downloading model",
			compact: false,
			label: "",
			percent: 49,
			segmentCount: 20,
		});

		const segmentsRoot = container.querySelector(".voice-download-segments");
		const firstSegment = container.querySelector(".voice-download-segment");

		expect(segmentsRoot?.className).toContain("voice-download-segments");
		expect(firstSegment).not.toBeNull();
		expect(firstSegment?.className).toContain("voice-download-segment-vertical");
	});
});

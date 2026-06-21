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

	it("renders download progress as a segmented pill", () => {
		const { container } = render(VoiceDownloadProgress, {
			ariaLabel: "Downloading model",
			compact: false,
			label: "",
			percent: 49,
			segmentCount: 20,
		});

		const segmentsRoot = container.querySelector(".voice-download-segments");
		const segments = container.querySelectorAll(".voice-download-segment");

		expect(segmentsRoot?.className).toContain("rounded-sm");
		expect(segments).toHaveLength(20);
		expect(segments[0]?.className).not.toContain("rounded-l-md");
		expect(segments[19]?.className).not.toContain("rounded-r-md");
	});

	it("renders level palette with only filled segments", () => {
		const { container } = render(VoiceDownloadProgress, {
			ariaLabel: "Reasoning effort",
			compact: true,
			decorative: true,
			filledSegmentCount: 1,
			label: "",
			orientation: "vertical",
			percent: 20,
			segmentCount: 5,
			segmentFillPalette: "level",
			showContainerBorder: false,
			showPercent: false,
		});

		const segments = container.querySelectorAll(".voice-download-segment");
		expect(segments).toHaveLength(1);
		expect(segments[0]?.className).toContain("filled");
	});

	it("renders grouped setup bar with bottom-up fill across the full cell", () => {
		const { container } = render(VoiceDownloadProgress, {
			ariaLabel: "Reasoning effort",
			compact: true,
			decorative: true,
			fillWidth: true,
			filledSegmentCount: 2,
			label: "",
			orientation: "vertical",
			percent: 40,
			segmentCount: 5,
			segmentFillPalette: "level",
			setupBar: true,
			showContainerBorder: false,
			showPercent: false,
		});

		const root = container.querySelector(".voice-download-progress");
		const segments = container.querySelectorAll(".voice-download-segment");
		const filledSegments = container.querySelectorAll(".voice-download-segment.filled");

		expect(root?.className).toContain("fill-width");
		expect(root?.className).toContain("setup-bar");
		expect(segments).toHaveLength(5);
		expect(filledSegments).toHaveLength(2);
	});
});

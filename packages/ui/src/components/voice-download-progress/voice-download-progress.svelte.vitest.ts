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
			label: "",
			percent: 49,
			segmentCount: 20,
			showPercent: false,
			variant: "downloadCompact",
		});

		expect(container.querySelector('[data-variant="downloadCompact"]')).not.toBeNull();
		expect(container.querySelectorAll('[data-variant="downloadCompact"] > div:nth-child(1) > div')).toHaveLength(20);
		expect(container.textContent).not.toContain("49%");
	});

	it("renders download progress as a segmented pill", () => {
		const { container } = render(VoiceDownloadProgress, {
			ariaLabel: "Downloading model",
			label: "",
			percent: 49,
			segmentCount: 20,
			variant: "download",
		});

		const root = container.querySelector('[data-variant="download"]');
		const segments = container.querySelectorAll('[data-variant="download"] > div:nth-child(1) > div');

		expect(root).not.toBeNull();
		expect(segments).toHaveLength(20);
	});

	it("renders reasoningDiscrete with only filled segments", () => {
		const { container } = render(VoiceDownloadProgress, {
			ariaLabel: "Reasoning effort",
			decorative: true,
			filledSegmentCount: 1,
			label: "",
			percent: 20,
			segmentCount: 5,
			showPercent: false,
			variant: "reasoningDiscrete",
		});

		const segments = container.querySelectorAll('[data-variant="reasoningDiscrete"] > div:nth-child(1) > div');
		expect(segments).toHaveLength(1);
		expect(segments[0]?.className).toContain("bg-[var(--segment-fill");
	});

	it("renders setupReasoningBar with bottom-up fill across the full cell", () => {
		const { container } = render(VoiceDownloadProgress, {
			ariaLabel: "Reasoning effort",
			decorative: true,
			filledSegmentCount: 2,
			label: "",
			percent: 40,
			segmentCount: 5,
			showPercent: false,
			variant: "setupReasoningBar",
		});

		const root = container.querySelector('[data-variant="setupReasoningBar"]');
		const segments = container.querySelectorAll('[data-variant="setupReasoningBar"] > div > div');
		const filledSegments = Array.from(segments).filter((segment) =>
			segment.className.includes("bg-[var(--segment-fill")
		);

		expect(root).not.toBeNull();
		expect(segments).toHaveLength(5);
		expect(filledSegments).toHaveLength(2);
	});
});

import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import SegmentedProgressBar from "./segmented-progress-bar.svelte";

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

describe("SegmentedProgressBar", () => {
	it("renders animated percent when showPercent is enabled", () => {
		const { container } = render(SegmentedProgressBar, {
			ariaLabel: "Downloading model",
			label: "",
			percent: 49,
			segmentCount: 20,
			showPercent: true,
			variant: "downloadCompact",
		});

		expect(container.textContent).toContain("49%");
		expect(container.querySelector(".an-root")).not.toBeNull();
	});

	it("can hide the percent label while preserving segmented progress", () => {
		const { container } = render(SegmentedProgressBar, {
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
		const { container } = render(SegmentedProgressBar, {
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

	it("renders usageCompact with per-segment completeness ramp fills", () => {
		const { container } = render(SegmentedProgressBar, {
			ariaLabel: "AI usage",
			decorative: true,
			label: "",
			percent: 90,
			segmentCount: 10,
			showPercent: false,
			variant: "usageCompact",
		});

		const filledSegments = Array.from(
			container.querySelectorAll('[data-variant="usageCompact"] > div:nth-child(1) > div')
		).filter((segment) => segment.getAttribute("style")?.includes("--segment-fill"));

		expect(filledSegments).toHaveLength(9);
		expect(filledSegments[0]?.getAttribute("style")).toContain("var(--success)");
		expect(filledSegments[8]?.getAttribute("style")).toContain("var(--token-completeness-mid)");
	});

	it("renders reasoningDiscrete with only filled segments", () => {
		const { container } = render(SegmentedProgressBar, {
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
		expect(segments[0]?.getAttribute("style")).toContain("background-color: var(--success)");
	});

	it("renders setupReasoningBar with bottom-up fill across the full cell", () => {
		const { container } = render(SegmentedProgressBar, {
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
			segment.getAttribute("style")?.includes("background-color")
		);

		expect(root).not.toBeNull();
		expect(segments).toHaveLength(5);
		expect(filledSegments).toHaveLength(2);
		expect(segments[0]?.className).toContain("h-[3px]");
		expect(segments[0]?.className).toContain("w-full");
	});
});

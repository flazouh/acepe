import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import FullscreenAction from "./fullscreen-action.svelte";

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

describe("FullscreenAction Hugeicons", () => {
	it("renders the enter fullscreen action with the rounded expand icon", () => {
		const { container, getByLabelText } = render(FullscreenAction, {
			props: {
				isFullscreen: false,
			},
		});

		const button = getByLabelText("Fullscreen");
		expect(button).toBeTruthy();
		expect(button.className).toContain("size-5");
		expect(container.querySelector('svg[viewBox="0 0 20 20"]')).not.toBeNull();
		expect(container.querySelector("svg")?.getAttribute("class")).toContain("shrink-0");
	});

	it("renders the exit fullscreen action with the rounded collapse icon", () => {
		const { container, getByLabelText } = render(FullscreenAction, {
			props: {
				isFullscreen: true,
			},
		});

		const button = getByLabelText("Exit fullscreen");
		expect(button).toBeTruthy();
		expect(button.className).toContain("size-5");
		expect(container.querySelector('svg[viewBox="0 0 20 20"]')).not.toBeNull();
		expect(container.querySelector("svg")?.getAttribute("class")).toContain("shrink-0");
	});
});

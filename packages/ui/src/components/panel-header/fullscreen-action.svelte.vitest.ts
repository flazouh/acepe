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

describe("FullscreenAction rounded icons", () => {
	it("renders the enter fullscreen action with the rounded expand icon", () => {
		const { container, getByLabelText } = render(FullscreenAction, {
			props: {
				isFullscreen: false,
			},
		});

		expect(getByLabelText("Fullscreen")).toBeTruthy();
		expect(container.querySelector('svg[viewBox="0 0 20 20"]')).not.toBeNull();
		expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-3");
	});

	it("renders the exit fullscreen action with the rounded collapse icon", () => {
		const { container, getByLabelText } = render(FullscreenAction, {
			props: {
				isFullscreen: true,
			},
		});

		expect(getByLabelText("Exit fullscreen")).toBeTruthy();
		expect(container.querySelector('svg[viewBox="0 0 20 20"]')).not.toBeNull();
		expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-3");
	});
});

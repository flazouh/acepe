import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppTopBar from "./app-top-bar.svelte";

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

afterEach(() => cleanup());

const DRAG = "electrobun-webkit-app-region-drag";
const NO_DRAG = "electrobun-webkit-app-region-no-drag";

describe("AppTopBar", () => {
	it("acts as the window drag region when the host hides the native title bar", () => {
		render(AppTopBar, { props: { windowDraggable: true } });

		const bar = screen.getByTestId("app-top-bar");
		expect(bar.classList.contains(DRAG)).toBe(true);
	});

	it("keeps controls out of the drag region so clicks are not window moves", () => {
		render(AppTopBar, { props: { windowDraggable: true } });

		const sidebarToggle = screen.getByLabelText("Toggle Sidebar");
		const settings = screen.getByLabelText("Settings");

		expect(sidebarToggle.closest(`.${NO_DRAG}`)).not.toBeNull();
		expect(settings.closest(`.${NO_DRAG}`)).not.toBeNull();
	});

	it("stays inert when the host owns its own window chrome", () => {
		render(AppTopBar, { props: { windowDraggable: false } });

		const bar = screen.getByTestId("app-top-bar");
		expect(bar.classList.contains(DRAG)).toBe(false);
		expect(bar.querySelector(`.${NO_DRAG}`)).toBeNull();
	});
});

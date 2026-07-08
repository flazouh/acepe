import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import SidebarUpdateCard from "./sidebar-update-card.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

describe("SidebarUpdateCard", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders the default minimal card", () => {
		const view = render(SidebarUpdateCard, {
			kind: "available",
			version: "2026.4.4",
			onclick: () => undefined,
		});

		const card = view.container.querySelector('[data-testid="sidebar-update-card"]');
		expect(card?.getAttribute("data-variant")).toBe("minimal");
		expect(view.container.querySelector('[data-testid="sidebar-update-card-beam"]')).toBeNull();
		expect(view.getByText("Version 2026.4.4, ready")).toBeTruthy();
	});

	it("keeps the install action clickable", async () => {
		const onClick = vi.fn();
		const view = render(SidebarUpdateCard, {
			kind: "available",
			version: "2026.4.4",
			onclick: onClick,
		});

		await fireEvent.click(view.getByRole("button", { name: "Download and install 2026.4.4" }));

		expect(onClick).toHaveBeenCalledOnce();
	});

	it("renders progress states inside the same card", () => {
		const view = render(SidebarUpdateCard, {
			kind: "downloading",
			version: "2026.4.4",
			percent: 42,
			onclick: () => undefined,
		});

		const card = view.container.querySelector('[data-testid="sidebar-update-card"]');
		expect(card?.getAttribute("data-kind")).toBe("downloading");
		expect(view.getByText("Downloading 42%")).toBeTruthy();
		expect(view.container.querySelector('[data-testid="sidebar-update-card-progress"]')).toBeTruthy();
		const fill = view.container.querySelector('[data-testid="sidebar-update-card-progress-fill"]');
		expect(fill?.getAttribute("style")).toContain("width: 42%");
	});
});

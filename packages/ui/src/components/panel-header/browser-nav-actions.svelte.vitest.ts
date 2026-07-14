import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import BrowserNavActions from "./browser-nav-actions.svelte";

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

describe("BrowserNavActions Hugeicons wiring", () => {
	it("renders open external with the shared Hugeicons icon", () => {
		const view = render(BrowserNavActions, {
			showNavigation: false,
			showExternal: true,
			onOpenExternal: vi.fn(),
		});

		const icon = view.getByTestId("browser-nav-open-external-hugeicons-icon");

		expect(icon.tagName.toLowerCase()).toBe("svg");
		expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon.innerHTML).not.toBe("");
	});

	it("does not render the external-open icon when the control is hidden", () => {
		const view = render(BrowserNavActions, {
			showNavigation: false,
			showExternal: false,
			onOpenExternal: vi.fn(),
		});

		expect(view.queryByTestId("browser-nav-open-external-hugeicons-icon")).toBeNull();
	});
});

import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import PermissionBarSummaryFixture from "./fixtures/permission-bar-summary-fixture.svelte";

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

describe("AgentPanelPermissionBar", () => {
	it("keeps a visible label when the detailed summary is hidden", () => {
		const view = render(PermissionBarSummaryFixture, {
			props: {
				showSummary: false,
			},
		});

		expect(view.getByText("Permission required")).toBeTruthy();
		expect(view.getByTestId("permission-actions")).toBeTruthy();
		expect(view.queryByText("src/file.ts")).toBeNull();
	});

	it("renders the tool-call attachment as a bottom cap", () => {
		const view = render(PermissionBarSummaryFixture, {
			props: {
				attachment: "tool-call",
				showSummary: false,
			},
		});

		const permissionCard = view.container.querySelector(".permission-card-enter");

		expect(view.queryByText("Permission required")).toBeNull();
		expect(permissionCard?.parentElement?.className).toContain("permission-attached-shell");
		expect(permissionCard?.parentElement?.className).not.toContain("mt-[-1px]");
		expect(permissionCard?.className).toContain("permission-attached-card");
		expect(permissionCard?.className).toContain("inline-flex");
		expect(permissionCard?.className).toContain("px-1");
		expect(permissionCard?.className).toContain("py-1");
		expect(permissionCard?.className).toContain("rounded-sm");
		expect(permissionCard?.className).not.toContain("permission-attached-inverted-radius");
	});
});

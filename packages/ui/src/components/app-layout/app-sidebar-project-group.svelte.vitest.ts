import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import AppSidebarProjectGroup from "./app-sidebar-project-group.svelte";
import AppSidebarProjectGroupSnippetsFixture from "./__tests__/fixtures/app-sidebar-project-group-snippets-fixture.svelte";

afterEach(() => {
	cleanup();
});

describe("AppSidebarProjectGroup", () => {
	it("renders a named workspace surface with header and content regions", () => {
		const view = render(AppSidebarProjectGroup, {
			projectName: "Acepe",
			group: {
				name: "Acepe",
				badgeLabel: "A",
				color: "#ff5d5a",
				iconSrc: null,
				sessions: [],
			},
		});

		const surface = view.getByRole("group", { name: "Acepe" });

		expect(surface.hasAttribute("data-sidebar-project-surface")).toBe(true);
		expect(surface.querySelector("[data-sidebar-project-header]")).not.toBeNull();
		expect(surface.querySelector("[data-sidebar-project-content]")).not.toBeNull();
	});

	it("keeps custom header and expanded content inside the named surface", async () => {
		const view = render(AppSidebarProjectGroupSnippetsFixture, { expanded: true });
		const surface = view.getByRole("group", { name: "Acepe" });
		const header = surface.querySelector("[data-sidebar-project-header]");
		const content = surface.querySelector("[data-sidebar-project-content]");

		expect(header?.textContent).toContain("Acepe project");
		expect(content?.textContent).toContain("Session task");

		await view.rerender({ expanded: false });

		expect(content?.textContent).not.toContain("Session task");
	});
});

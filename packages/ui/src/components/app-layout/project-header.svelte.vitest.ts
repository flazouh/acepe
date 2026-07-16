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

import ProjectHeader from "./project-header.svelte";

afterEach(() => {
	cleanup();
});

describe("ProjectHeader", () => {
	it("keeps the expand chevron in the same sized surface as the project badge", () => {
		const view = render(ProjectHeader, {
			projectName: "Acepe",
			projectBadgeLabel: "Ac",
			projectColor: "#7c5cff",
			expanded: false,
		});

		const leading = view.getByTestId("project-header-leading");
		const badge = view.getByTestId("project-header-badge");
		const chevron = view.getByTestId("project-header-chevron");

		expect(leading.className).toContain("size-4");
		expect(badge.className).toContain("absolute");
		expect(badge.className).toContain("inset-0");
		expect(chevron.className).toContain("absolute");
		expect(chevron.className).toContain("inset-0");
		expect(chevron.className).toContain("opacity-0");
		expect(chevron.className).toContain("group-hover:opacity-100");
		expect(badge.className).toContain("group-hover:opacity-0");
		expect(view.container.querySelector('[data-testid="project-header-chevron"] ~ *')).toBeNull();
		expect(view.getByText("Acepe")).toBeTruthy();
	});

	it("rotates the leading chevron when the project is expanded", () => {
		const view = render(ProjectHeader, {
			projectName: "Acepe",
			projectColor: "#7c5cff",
			expanded: true,
		});

		const chevronIcon = view
			.getByTestId("project-header-chevron")
			.querySelector("svg, [class*='rotate-90']");
		expect(chevronIcon?.className.toString()).toContain("rotate-90");
	});
});

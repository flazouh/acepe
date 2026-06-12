import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS_SECTIONS } from "./settings-section-registry.js";
import SettingsSidebar from "./settings-sidebar.svelte";

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

describe("SettingsSidebar", () => {
	it("renders grouped navigation with section labels", () => {
		const view = render(SettingsSidebar, {
			activeSection: "general",
			onSectionChange: vi.fn(),
		});

		const rail = view.container.querySelector("nav");
		expect(rail).not.toBeNull();
		expect(rail?.className).toContain("w-[208px]");
		expect(view.getByText("Workspace")).toBeTruthy();
		expect(view.getByText("Data")).toBeTruthy();
		expect(view.getAllByText("General").length).toBeGreaterThanOrEqual(1);
		expect(view.getAllByText("Agents").length).toBeGreaterThanOrEqual(1);

		const navButtons = rail?.querySelectorAll("button") ?? [];
		expect(navButtons).toHaveLength(SETTINGS_SECTIONS.length);

		for (const button of navButtons) {
			expect(button.className).toContain("gap-2");
			expect(button.className).toContain("text-[13px]");
		}

		const activeButton = view.getByRole("button", { name: "General" });
		expect(activeButton.className).toContain("bg-accent");
	});

	it("calls onSectionChange when clicking a section row", async () => {
		const onSectionChange = vi.fn<(section: string) => void>();
		const view = render(SettingsSidebar, {
			activeSection: "general",
			onSectionChange,
		});

		const worktreesButton = view.getByRole("button", { name: "Worktrees" });
		await fireEvent.click(worktreesButton);

		expect(onSectionChange).toHaveBeenCalledWith("worktrees");
	});
});

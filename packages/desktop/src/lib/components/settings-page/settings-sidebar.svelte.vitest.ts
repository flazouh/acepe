import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

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
	it("renders a compact flat sidebar without header/group labels", () => {
		const view = render(SettingsSidebar, {
			activeSection: "general",
			onSectionChange: vi.fn(),
		});

		const rail = view.container.querySelector("nav");
		expect(rail).not.toBeNull();
		expect(rail?.className).toContain("w-[160px]");
		expect(view.queryByText("Account")).toBeNull();
		expect(view.queryByText("Workspace")).toBeNull();
		expect(view.queryByText("AI")).toBeNull();
		expect(view.queryByText("Data")).toBeNull();
		expect(view.queryByRole("button", { name: "Language" })).toBeNull();

		const navButtons = rail?.querySelectorAll("button") ?? [];
		expect(navButtons).toHaveLength(13);

		for (const button of navButtons) {
			expect(button.className).toContain("gap-2");
			expect(button.className).toContain("text-[12px]");
		}

		const activeButton = view.getByRole("button", { name: "General" });
		expect(activeButton.className).toContain("bg-muted");
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

	it("renders the project section when project settings are available", () => {
		const view = render(SettingsSidebar, {
			activeSection: "project",
			onSectionChange: vi.fn(),
			showProjectSection: true,
		});

		expect(view.getByRole("button", { name: "Projects" })).toBeTruthy();
	});
});

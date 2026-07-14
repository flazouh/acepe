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

vi.mock("@acepe/ui", async () => {
	const IconStub = (await import("./settings-sidebar-test-icon-stub.svelte")).default;

	return {
		PaletteIcon: IconStub,
		RobotIcon: IconStub,
	};
});

describe("SettingsSidebar", () => {
	it("renders grouped navigation with section labels", () => {
		const view = render(SettingsSidebar, {
			activeSection: "general",
			onSectionChange: vi.fn(),
		});

		const rail = view.container.querySelector("nav");
		expect(rail).not.toBeNull();
		expect(rail?.className).toContain("flex-col");
		expect(view.getByText("Workspace")).toBeTruthy();
		expect(view.getByText("Data")).toBeTruthy();
		expect(view.getAllByText("General").length).toBeGreaterThanOrEqual(1);
		expect(view.getAllByText("Agents").length).toBeGreaterThanOrEqual(1);

		const navButtons = rail?.querySelectorAll("button") ?? [];
		expect(navButtons).toHaveLength(SETTINGS_SECTIONS.length);

		for (const button of navButtons) {
			expect(button.className).toContain("gap-1.5");
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

		const gitButton = view.getByRole("button", { name: "Git" });
		await fireEvent.click(gitButton);

		expect(onSectionChange).toHaveBeenCalledWith("git");
	});

	it("renders Hugeicons settings row icons", () => {
		const view = render(SettingsSidebar, {
			activeSection: "general",
			onSectionChange: vi.fn(),
		});

		const generalIcon = view.getByTestId("settings-section-general-icon");
		const skillsIcon = view.getByTestId("settings-section-skills-icon");

		expect(generalIcon.tagName.toLowerCase()).toBe("svg");
		expect(generalIcon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(generalIcon.innerHTML).not.toBe("");
		expect(skillsIcon.tagName.toLowerCase()).toBe("svg");
		expect(skillsIcon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(skillsIcon.innerHTML).not.toBe("");
	});
});

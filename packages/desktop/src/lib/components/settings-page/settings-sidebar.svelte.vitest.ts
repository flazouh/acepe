import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import SettingsSidebar from "./settings-sidebar.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../node_modules/svelte/src/index-client.js")
);

describe("SettingsSidebar", () => {
	it("renders a compact flat sidebar without header/group labels", () => {
		const view = render(SettingsSidebar, {
			activeSection: "general",
			onSectionChange: vi.fn(),
		});

		const rail = view.container.querySelector("aside");
		expect(rail).not.toBeNull();
		expect(rail?.className).toContain("w-64");
		expect(view.queryByText("Account")).toBeNull();
		expect(view.queryByText("Workspace")).toBeNull();
		expect(view.queryByText("AI")).toBeNull();
		expect(view.queryByText("Data")).toBeNull();

		const navButtons = view.container.querySelectorAll("nav button");
		expect(navButtons).toHaveLength(6);

		for (const button of navButtons) {
			expect(button.className).toContain("justify-start");
			expect(button.className).toContain("h-8");
			expect(button.getAttribute("title")).not.toBeNull();
			expect(button.getAttribute("aria-label")).not.toBeNull();
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

		const languageButton = view.getByRole("button", { name: "Language" });
		await fireEvent.click(languageButton);

		expect(onSectionChange).toHaveBeenCalledWith("language");
	});
});

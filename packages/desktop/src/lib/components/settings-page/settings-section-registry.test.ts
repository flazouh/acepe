import { describe, expect, it, vi } from "vitest";

vi.mock("@acepe/ui", () => {
	return {
		PaletteIcon: () => null,
		RobotIcon: () => null,
	};
});

describe("settings section registry", () => {
	it("routes the General settings row to the targeted Linear interface icon", async () => {
		const { getSettingsSectionDefinition } = await import("./settings-section-registry.js");
		const general = getSettingsSectionDefinition("general");

		expect(general).toMatchObject({
			id: "general",
			label: "General",
			linearInterfaceIcon: "settings-general",
		});
		expect(general.roundedIcon).toBeUndefined();
	});

	it("routes the Skills settings row to the targeted Linear interface icon", async () => {
		const { getSettingsSectionDefinition } = await import("./settings-section-registry.js");
		const skills = getSettingsSectionDefinition("skills");

		expect(skills).toMatchObject({
			id: "skills",
			label: "Skills",
			linearInterfaceIcon: "settings-skills",
		});
		expect(skills.roundedIcon).toBeUndefined();
	});
});

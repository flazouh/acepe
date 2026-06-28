import { describe, expect, test } from "bun:test";

import {
	flattenSlashPaletteItems,
	getSlashPaletteVisibleSections,
	slashPaletteHasContent,
	SLASH_PALETTE_SECTION_PREVIEW_COUNT,
	type SlashPaletteSection,
} from "./agent-input-slash-palette-state.js";

function makeSection(
	id: SlashPaletteSection["id"],
	label: string,
	count: number
): SlashPaletteSection {
	const items = Array.from({ length: count }, (_, index) => ({
		id: `${id}-${index}`,
		kind: id === "modes" ? ("mode" as const) : ("command" as const),
		label: `${label} ${index}`,
		description: null,
	}));
	return { id, label, items };
}

describe("agent input slash palette state", () => {
	test("detects palette content", () => {
		expect(slashPaletteHasContent([])).toBe(false);
		expect(slashPaletteHasContent([makeSection("commands", "Commands", 0)])).toBe(false);
		expect(slashPaletteHasContent([makeSection("skills", "Skills", 2)])).toBe(true);
	});

	test("previews three items per section until expanded", () => {
		const sections = [makeSection("skills", "Skills", SLASH_PALETTE_SECTION_PREVIEW_COUNT + 2)];
		const visible = getSlashPaletteVisibleSections({
			sections,
			query: "",
			expandedSectionIds: new Set(),
		});

		expect(visible).toHaveLength(1);
		expect(visible[0]?.items).toHaveLength(SLASH_PALETTE_SECTION_PREVIEW_COUNT);
		expect(visible[0]?.hiddenCount).toBe(2);
	});

	test("filters items when searching", () => {
		const sections: SlashPaletteSection[] = [
			{
				id: "commands",
				label: "Commands",
				items: [
					{ id: "a", kind: "command", label: "review", description: null },
					{ id: "b", kind: "command", label: "commit", description: null },
				],
			},
		];
		const visible = getSlashPaletteVisibleSections({
			sections,
			query: "rev",
			expandedSectionIds: new Set(),
		});

		expect(visible[0]?.items.map((item) => item.label)).toEqual(["review"]);
	});

	test("flattens visible sections for keyboard navigation", () => {
		const visible = getSlashPaletteVisibleSections({
			sections: [
				makeSection("modes", "Modes", 2),
				makeSection("commands", "Commands", 1),
			],
			query: "",
			expandedSectionIds: new Set(["modes", "commands"]),
		});
		expect(flattenSlashPaletteItems(visible)).toHaveLength(3);
	});
});

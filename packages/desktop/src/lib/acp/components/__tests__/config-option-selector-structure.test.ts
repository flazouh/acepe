import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const configOptionSelectorPath = resolve(__dirname, "../config-option-selector.svelte");
const configOptionSelectorSource = readFileSync(configOptionSelectorPath, "utf8");

describe("config option selector structure", () => {
	it("keeps the dropdown trigger as the outer trigger so the menu can open", () => {
		const dropdownTriggerIndex = configOptionSelectorSource.indexOf("<DropdownMenu.Trigger");
		const tooltipRootIndex = configOptionSelectorSource.indexOf("<Tooltip.Root>");

		expect(dropdownTriggerIndex).toBeGreaterThan(-1);
		expect(tooltipRootIndex).toBeGreaterThan(-1);
		expect(dropdownTriggerIndex).toBeLessThan(tooltipRootIndex);
	});
});

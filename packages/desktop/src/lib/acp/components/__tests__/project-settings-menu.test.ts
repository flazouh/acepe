import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const menuPath = resolve(__dirname, "../project-settings-menu.svelte");
const source = readFileSync(menuPath, "utf8");

describe("project settings menu", () => {
	it("does not render the activity chart in the dropdown", () => {
		expect(source).not.toContain("<ActivityChart");
	});

	it("uses compact submenu sections for filters and color picker", () => {
		expect(source).toContain("<DropdownMenu.Sub>");
		expect(source).toContain("<DropdownMenu.SubTrigger>");
		expect(source).toContain("<DropdownMenu.SubContent");
	});

	it("uses the shared project color options", () => {
		expect(source).toContain(
			'import { PROJECT_COLOR_OPTIONS } from "../utils/project-color-options.js";'
		);
		expect(source).not.toContain("const colorOptions = [");
	});
});

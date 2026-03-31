import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const menuPath = resolve(__dirname, "../project-header-overflow-menu.svelte");
const source = readFileSync(menuPath, "utf8");

describe("project header overflow menu", () => {
	it("uses the shared project color options", () => {
		expect(source).toContain(
			'import { PROJECT_COLOR_OPTIONS } from "../utils/project-color-options.js";'
		);
		expect(source).not.toContain("const colorOptions = [");
	});
});
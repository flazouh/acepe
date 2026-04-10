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

	it("hosts project display mode as an inline pill toggle", () => {
		expect(source).toContain('type ProjectViewMode = "sessions" | "files";');
		expect(source).toContain("currentViewMode?: ProjectViewMode;");
		expect(source).toContain("onViewModeChange?: (mode: ProjectViewMode) => void;");
		expect(source).toContain('role="group" aria-label="Display"');
		expect(source).toContain('aria-pressed={currentViewMode === "sessions"}');
		expect(source).toContain('aria-pressed={currentViewMode === "files"}');
		expect(source).toContain('onclick={() => handleViewModeSelect("sessions")}');
		expect(source).toContain('onclick={() => handleViewModeSelect("files")}');
		expect(source).toContain("menuOpen = false;");
		expect(source).toContain("{m.sidebar_view_sessions()}");
		expect(source).toContain("{m.sidebar_view_files()}");
		expect(source).not.toContain("<DropdownMenu.RadioGroup value={currentViewMode}>");
	});
});

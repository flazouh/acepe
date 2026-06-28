import { describe, expect, it } from "bun:test";

import { buildDropdownMenuSurfaceClassName } from "./dropdown-menu-surface.classes";

describe("buildDropdownMenuSurfaceClassName", () => {
	it("uses surface elevation ladder for main and sub menus", () => {
		const className = buildDropdownMenuSurfaceClassName();

		expect(className).toContain("rounded-xl");
		expect(className).toContain("bg-surface-3");
		expect(className).toContain("shadow-surface-3");
		expect(className).toContain("p-1");
		expect(className).not.toContain("shadow-md");
		expect(className).not.toContain("bg-popover");
	});

	it("steps bg level from substrate for nested submenus", () => {
		const className = buildDropdownMenuSurfaceClassName(undefined, 3);

		expect(className).toContain("bg-surface-5");
		expect(className).toContain("shadow-surface-3");
	});
});

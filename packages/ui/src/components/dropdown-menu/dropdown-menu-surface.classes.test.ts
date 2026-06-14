import { describe, expect, it } from "bun:test";

import { buildDropdownMenuSurfaceClassName } from "./dropdown-menu-surface.classes";

describe("buildDropdownMenuSurfaceClassName", () => {
	it("uses the shared rounded dropdown chrome for main and sub menus", () => {
		const className = buildDropdownMenuSurfaceClassName();

		expect(className).toContain("rounded-xl");
		expect(className).toContain("p-1");
		expect(className).toContain("shadow-md");
		expect(className).not.toContain("zoom-in-95");
	});
});

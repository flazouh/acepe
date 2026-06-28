import { describe, expect, it } from "bun:test";

import { buildDropdownMenuSurfaceClassName } from "./dropdown-menu-surface.classes";

describe("buildDropdownMenuSurfaceClassName", () => {
	it("uses the shared rounded dropdown chrome for main and sub menus", () => {
		const className = buildDropdownMenuSurfaceClassName();

		expect(className).toContain("rounded-lg");
		expect(className).not.toContain("rounded-md");
		expect(className).toContain("p-0.5");
		expect(className).toContain("shadow-md");
		expect(className).not.toContain("zoom-in-95");
	});
});

import { describe, expect, it } from "bun:test";

import { buildDropdownMenuItemClassName } from "./dropdown-menu-item.classes";

import {
	dropdownMenuItemTypographyClass,
} from "./dropdown-menu-typography.js";

describe("buildDropdownMenuItemClassName", () => {
	it("uses fluid-aligned row typography", () => {
		const className = buildDropdownMenuItemClassName(false);
		expect(className).toContain(dropdownMenuItemTypographyClass);
		expect(className).toContain("text-[13px]");
	});

	it("keeps nested SVG icons muted by default but restores currentColor in interactive states", () => {
		const className = buildDropdownMenuItemClassName(false);

		expect(className).toContain("[&_svg:not([class*='text-'])]:text-muted-foreground");
		expect(className).toContain("hover:[&_svg:not([class*='text-'])]:text-current");
		expect(className).toContain("data-[highlighted]:[&_svg:not([class*='text-'])]:text-current");
		expect(className).toContain("data-[proximity-active]:[&_svg:not([class*='text-'])]:text-current");
	});

	it("uses transparent rows with muted text when rendered over sliding highlight layers", () => {
		const className = buildDropdownMenuItemClassName(true);

		expect(className).toContain("bg-transparent text-muted-foreground");
		expect(className).toContain("data-[proximity-active]:text-foreground");
		expect(className).not.toContain("hover:bg-accent");
	});

	it("uses rounded-lg menu row geometry", () => {
		const className = buildDropdownMenuItemClassName(true);

		expect(className).toContain("rounded-lg");
		expect(className).not.toContain("rounded-md");
	});

	it("applies fluid-style font-weight shift on interactive states", () => {
		const className = buildDropdownMenuItemClassName(true);

		expect(className).toContain("dropdown-menu-weight-shift");
	});
});

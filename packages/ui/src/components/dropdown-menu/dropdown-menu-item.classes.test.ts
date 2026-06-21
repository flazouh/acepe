import { describe, expect, it } from "bun:test";

import { buildDropdownMenuItemClassName } from "./dropdown-menu-item.classes";

describe("buildDropdownMenuItemClassName", () => {
	it("keeps nested SVG icons muted by default but restores currentColor in interactive states", () => {
		const className = buildDropdownMenuItemClassName(false);

		expect(className).toContain("[&_svg:not([class*='text-'])]:text-muted-foreground");
		expect(className).toContain("hover:[&_svg:not([class*='text-'])]:text-current");
		expect(className).toContain("data-[highlighted]:[&_svg:not([class*='text-'])]:text-current");
		expect(className).toContain("aria-selected:[&_svg:not([class*='text-'])]:text-current");
	});

	it("preserves the highlight-context text behavior for items rendered over the sliding highlight", () => {
		const className = buildDropdownMenuItemClassName(true);

		expect(className).toContain("bg-transparent text-popover-foreground");
		expect(className).not.toContain("hover:bg-muted");
	});

	it("uses rounded menu row geometry", () => {
		const className = buildDropdownMenuItemClassName(true);

		expect(className).toContain("rounded-md");
		expect(className).not.toContain("rounded-lg");
	});
});
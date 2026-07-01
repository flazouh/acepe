import { describe, expect, test } from "vitest";

import { buttonVariants } from "./variants.js";

describe("buttonVariants", () => {
	test("mutes inactive chrome icon buttons until hover or focus", () => {
		const className = buttonVariants({ variant: "ghost", size: "icon-chrome" });

		expect(className).toContain("text-muted-foreground/35");
		expect(className).toContain("[&_svg]:text-muted-foreground/35");
		expect(className).toContain("hover:text-foreground");
		expect(className).toContain("hover:[&_svg]:text-foreground");
		expect(className).toContain("focus-visible:text-foreground");
		expect(className).toContain("focus-visible:[&_svg]:text-foreground");
	});
});

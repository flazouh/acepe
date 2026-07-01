import { describe, expect, test } from "vitest";

import { buttonVariants } from "./variants.js";

describe("desktop buttonVariants", () => {
	test.each(["icon-chrome", "icon-2xs"] as const)(
		"mutes inactive %s ghost buttons until hover or focus",
		(size) => {
			const className = buttonVariants({ variant: "ghost", size });

			expect(className).toContain("text-muted-foreground/35");
			expect(className).toContain("[&_svg]:text-muted-foreground/35");
			expect(className).toContain("[&_svg_*]:text-muted-foreground/35");
			expect(className).toContain("hover:text-foreground");
			expect(className).toContain("hover:[&_svg]:text-foreground");
			expect(className).toContain("hover:[&_svg_*]:text-foreground");
			expect(className).toContain("focus-visible:text-foreground");
			expect(className).toContain("focus-visible:[&_svg]:text-foreground");
			expect(className).toContain("focus-visible:[&_svg_*]:text-foreground");
		}
	);
});

import { describe, expect, test } from "vitest";

import { buttonVariants } from "./variants.js";

describe("desktop buttonVariants", () => {
	test("keeps icon button sizes in a normal sm/default/md/lg scale", () => {
		expect(buttonVariants({ size: "icon-sm" })).toContain("size-5");
		expect(buttonVariants({ size: "icon" })).toContain("size-6");
		expect(buttonVariants({ size: "icon-md" })).toContain("size-7");
		expect(buttonVariants({ size: "icon-lg" })).toContain("size-8");
	});

	test("keeps inactive icon ghost buttons at full opacity until hover or focus", () => {
		const className = buttonVariants({ variant: "ghost", size: "icon" });

		expect(className).toContain("size-6");
		expect(className).toContain("[&_svg]:!size-4");
		expect(className).toContain("text-muted-foreground");
		expect(className).toContain("[&_svg]:text-muted-foreground");
		expect(className).toContain("[&_svg_*]:text-muted-foreground");
		expect(className).not.toContain("text-muted-foreground/35");
		expect(className).toContain("hover:text-foreground");
		expect(className).toContain("hover:[&_svg]:text-foreground");
		expect(className).toContain("hover:[&_svg_*]:text-foreground");
		expect(className).toContain("focus-visible:text-foreground");
		expect(className).toContain("focus-visible:[&_svg]:text-foreground");
		expect(className).toContain("focus-visible:[&_svg_*]:text-foreground");
	});
});

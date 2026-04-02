import { describe, expect, it } from "bun:test";

import { buttonVariants } from "./variants.js";

describe("button variant contract", () => {
	it("adds a shared header-action button variant for compact toolbar actions", () => {
		const classes = buttonVariants({ variant: "header", size: "header" });

		expect(classes).toContain("h-7");
		expect(classes).toContain("px-3");
		expect(classes).toContain("text-xs");
		expect(classes).toContain("border");
		expect(classes).toContain("border-border/50");
		expect(classes).toContain("bg-background");
		expect(classes).toContain("text-foreground");
		expect(classes).toContain("hover:bg-accent/40");
	});
});
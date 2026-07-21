import { describe, expect, it } from "bun:test";

import { buildChipShellClassName } from "./chip-shell.classes.js";

describe("buildChipShellClassName", () => {
	it("uses one rounded-md chip surface for badge density", () => {
		const className = buildChipShellClassName({ density: "badge", interactive: true });

		expect(className).toContain("rounded-md");
		expect(className).toContain("border");
		expect(className).toContain("border-border/60");
		expect(className).toContain("bg-accent");
		expect(className).toContain("text-accent-foreground");
		expect(className).not.toContain("hover:bg-accent");
		expect(className).not.toContain("hover:text-accent-foreground");
		expect(className).toContain("px-1");
		expect(className).toContain("py-0.5");
	});

	it("supports compact badge sizing on the same chip surface", () => {
		const className = buildChipShellClassName({ density: "badge", size: "sm" });

		expect(className).toContain("rounded-md");
		expect(className).toContain("px-0.5");
		expect(className).toContain("py-px");
		expect(className).toContain("text-[0.625rem]");
	});

	it("shares the same rounded-md chip surface for inline density", () => {
		const badge = buildChipShellClassName({ density: "badge" });
		const inline = buildChipShellClassName({ density: "inline" });

		expect(inline).toContain("rounded-md");
		expect(inline).toContain("border");
		expect(inline).toContain("border-border/60");
		expect(inline).toContain("bg-accent");
		expect(inline).toContain("text-accent-foreground");
		expect(inline).toContain("px-1");
		expect(inline).toContain("py-0.5");
		expect(inline).toContain("text-[11px]");

		for (const token of [
			"rounded-md",
			"border",
			"border-border/60",
			"bg-accent",
			"text-accent-foreground",
		]) {
			expect(badge).toContain(token);
			expect(inline).toContain(token);
		}
	});

	it("supports plain header chips without badge chrome", () => {
		const className = buildChipShellClassName({ density: "plain", interactive: true });

		expect(className).toContain("bg-transparent");
		expect(className).toContain("border-0");
		expect(className).not.toContain("bg-accent");
		expect(className).toContain("hover:text-foreground");
	});

	it("supports selected chips", () => {
		const className = buildChipShellClassName({ density: "badge", selected: true });

		expect(className).toContain("bg-accent");
		expect(className).toContain("text-accent-foreground");
		expect(className).toContain("border-border");
	});
});

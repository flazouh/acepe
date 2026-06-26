import { describe, expect, it } from "bun:test";

import { buildChipShellClassName } from "./chip-shell.classes.js";

describe("buildChipShellClassName", () => {
	it("uses rounded-sm shared badge chrome for interactive file and github chips", () => {
		const className = buildChipShellClassName({ density: "badge", interactive: true });

		expect(className).toContain("rounded-sm");
		expect(className).toContain("border");
		expect(className).toContain("border-border/60");
		expect(className).toContain("bg-accent");
		expect(className).toContain("text-accent-foreground");
		expect(className).not.toContain("hover:bg-accent");
		expect(className).not.toContain("hover:text-accent-foreground");
		expect(className).toContain("px-1");
		expect(className).toContain("py-0.5");
	});

	it("supports compact badge sizing for small file chips", () => {
		const className = buildChipShellClassName({ density: "badge", size: "sm" });

		expect(className).toContain("rounded-sm");
		expect(className).toContain("px-0.5");
		expect(className).toContain("py-px");
		expect(className).toContain("text-[0.625rem]");
	});

	it("supports inline artefact spacing while sharing the same chip shell chrome", () => {
		const className = buildChipShellClassName({ density: "inline" });

		expect(className).toContain("rounded-md");
		expect(className).toContain("border");
		expect(className).toContain("px-1");
		expect(className).toContain("py-0.5");
		expect(className).toContain("text-[11px]");
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
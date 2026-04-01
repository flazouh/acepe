import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./input-container.svelte"), "utf8");

describe("input container contract", () => {
	it("clips footer children to the inherited bottom corners", () => {
		expect(source).toContain("rounded-xl bg-input/30");
		expect(source).toContain(
			'class="flex items-center justify-between gap-2 h-7 border-t border-border/50 overflow-hidden rounded-b-[inherit]"'
		);
	});
});
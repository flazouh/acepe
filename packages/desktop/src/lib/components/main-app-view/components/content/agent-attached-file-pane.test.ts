import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "./agent-attached-file-pane.svelte"), "utf8");

describe("agent attached file pane layout", () => {
	it("keeps the file panel constrained to the height below the attached tabs", () => {
		expect(source).toContain("flex-col gap-0 overflow-hidden");
		expect(source).toContain("min-h-8 shrink-0 items-center");
		expect(source).toContain('class="min-h-0 flex-1 overflow-hidden"');
	});
});

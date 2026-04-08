import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "./agent-panel.svelte"), "utf8");

describe("agent panel surface contract", () => {
	it("owns an opaque rounded panel surface at the root", () => {
		expect(source).toContain("bg-card");
		expect(source).toContain("rounded-lg overflow-hidden relative border border-border");
		expect(source).not.toContain("bg-transparent rounded-lg overflow-hidden relative border border-border");
	});
});
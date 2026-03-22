import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prStatusCardPath = resolve(__dirname, "../pr-status-card/pr-status-card.svelte");
const source = readFileSync(prStatusCardPath, "utf8");

describe("PR status card loading fallback", () => {
	it("renders a non-empty placeholder while details for an existing PR are still loading", () => {
		expect(source).toContain("{:else if prNumber != null}");
		expect(source).toContain("#{prNumber}");
	});
});

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prStatusCardPath = resolve(__dirname, "../pr-status-card/pr-status-card.svelte");
const source = readFileSync(prStatusCardPath, "utf8");
const headerIndex = source.indexOf("<!-- Header bar -->");
const expandedContentIndex = source.indexOf(
	"<!-- Expanded content: streaming preview OR description + commits -->"
);

describe("PR status card loading fallback", () => {
	it("renders a non-empty placeholder while details for an existing PR are still loading", () => {
		expect(source).toContain("{:else if prNumber != null}");
		expect(source).toContain("#{prNumber}");
	});

	it("renders the PR action bar before the expanded content markup", () => {
		expect(headerIndex).toBeGreaterThan(-1);
		expect(expandedContentIndex).toBeGreaterThan(-1);
		expect(headerIndex).toBeLessThan(expandedContentIndex);
	});
});

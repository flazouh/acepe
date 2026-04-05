import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "./pr-status-card.svelte"), "utf8");

describe("pr-status-card structure", () => {
	it("does not contain the merge button — merge lives in modified-files-header", () => {
		expect(source).not.toContain("onMerge");
		expect(source).not.toContain("mergeStrategyStore");
		expect(source).not.toContain("m.pr_card_merge()");
		expect(source).not.toContain("m.pr_card_squash_merge()");
	});
});

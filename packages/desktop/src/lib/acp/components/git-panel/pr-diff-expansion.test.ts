import { describe, expect, it } from "vitest";

import { getNextExpandedPrFilePath } from "./pr-diff-expansion.js";

describe("getNextExpandedPrFilePath", () => {
	it("expands a file when none is selected", () => {
		expect(getNextExpandedPrFilePath(null, "src/routes/+page.svelte")).toBe(
			"src/routes/+page.svelte"
		);
	});

	it("collapses the file when the same file is clicked again", () => {
		expect(
			getNextExpandedPrFilePath("src/routes/+page.svelte", "src/routes/+page.svelte")
		).toBeNull();
	});

	it("switches the expanded file when a different file is clicked", () => {
		expect(getNextExpandedPrFilePath("src/routes/+page.svelte", "src/lib/utils.ts")).toBe(
			"src/lib/utils.ts"
		);
	});
});

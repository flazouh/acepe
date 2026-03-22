import { describe, expect, it } from "vitest";

import { shouldUsePlainTextDiffPreview } from "./pr-diff-preview-mode.js";

describe("shouldUsePlainTextDiffPreview", () => {
	it("keeps small patches on the rich diff path", () => {
		expect(shouldUsePlainTextDiffPreview("@@ -1 +1 @@\n-old\n+new")).toBe(false);
	});

	it("switches to the plain-text path for very long patches", () => {
		const largePatch = `${"@@ -1 +1 @@\n-old\n+new\n".repeat(1200)}`;
		expect(shouldUsePlainTextDiffPreview(largePatch)).toBe(true);
	});
});

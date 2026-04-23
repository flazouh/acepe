import { describe, expect, it } from "vitest";

import { WEBSITE_MARKDOWN_LANGUAGES } from "./markdown-renderer";

describe("website markdown renderer", () => {
	it("loads svelte fences used by the homepage demos", () => {
		expect(WEBSITE_MARKDOWN_LANGUAGES).toContain("svelte");
	});
});

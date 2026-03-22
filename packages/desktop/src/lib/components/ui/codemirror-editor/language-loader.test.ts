import { describe, expect, it } from "bun:test";

import { getLanguageFromFilename, loadLanguageByName } from "./language-loader.js";

describe("language-loader", () => {
	it("maps .svelte files to svelte language", () => {
		expect(getLanguageFromFilename("Component.svelte")).toBe("svelte");
	});

	it("loads non-null language support for svelte", async () => {
		const result = await loadLanguageByName("svelte");

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).not.toBeNull();
		}
	});
});

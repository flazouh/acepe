import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { getLanguageFromFilename, loadLanguageByName } from "./language-loader.js";

describe("language-loader", () => {
	it("maps .svelte files to svelte language", () => {
		expect(getLanguageFromFilename("Component.svelte")).toBe("svelte");
	});

	it("loads non-null language support for svelte", async () => {
		const result = await Effect.runPromise(Effect.result(loadLanguageByName("svelte")));

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).not.toBeNull();
		}
	});
});

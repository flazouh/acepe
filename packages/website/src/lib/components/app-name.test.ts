import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("app name", () => {
	it("uses the hero heading font and shimmer treatment", async () => {
		const source = await readFile(new URL("./app-name.svelte", import.meta.url), "utf8");

		expect(source).toContain('import { TextShimmer } from "@acepe/ui";');
		expect(source).toContain("font-sans");
		expect(source).toContain('{"Acepe"}');
	});
});

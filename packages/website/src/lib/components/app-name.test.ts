import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("app name", () => {
	it("uses the hero heading font and shimmer treatment", async () => {
		const source = await readFile(
			new URL("./landing-v2/warp-header.svelte", import.meta.url),
			"utf8"
		);

		expect(source).toContain("BrandLockup");
		expect(source).toContain('from "@acepe/ui"');
		expect(source).toContain('wordmarkClass="text-[20px] text-foreground"');
	});
});

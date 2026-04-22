import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("header actions", () => {
	it("renders plain download labels and pointer theme toggles", async () => {
		const source = await readFile(new URL("./header.svelte", import.meta.url), "utf8");

		expect(source).toContain('import { BrandLockup } from "@acepe/ui";');
		expect(source).not.toContain('<TextShimmer>{"Download"}</TextShimmer>');
		expect(source).toContain("cursor-pointer items-center justify-center rounded-full");
	});
});

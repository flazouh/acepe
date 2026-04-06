import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("header actions", () => {
	it("renders plain download labels and pointer theme toggles", async () => {
		const source = await readFile(new URL("./header.svelte", import.meta.url), "utf8");

		expect(source).toContain('import AppName from "$lib/components/app-name.svelte";');
		expect(source).not.toContain("<TextShimmer>{m.nav_download()}</TextShimmer>");
		expect(source).toContain("cursor-pointer items-center justify-center rounded-full");
	});
});

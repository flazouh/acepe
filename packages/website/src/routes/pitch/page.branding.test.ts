import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

const { default: Page } = await import("./+page.svelte");

describe("pitch page branding contract", () => {
	it("reuses Acepe brand primitives instead of route-local replacements", async () => {
		const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");

		expect(source).toContain("BrandShaderBackground");
		expect(source).toContain("BrandLockup");
		expect(source).toContain("from '@acepe/ui'");
		expect(source).not.toContain("@font-face");
		expect(source).not.toContain("--background:");
	});

	it("renders the Acepe lockup and card-like slide surfaces", () => {
		const { body } = render(Page);

		expect(body).toContain("ACEPE");
		expect(body).toContain("bg-card/60");
		expect(body).toContain("border-border/60");
	});
});

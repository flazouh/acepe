import { readFile } from "node:fs/promises";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

const { default: Page } = await import("./+page.svelte");

describe("pitch page branding contract", () => {
	it("reuses Acepe brand primitives instead of route-local replacements", async () => {
		const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");

		expect(source).toContain("BrandLockup");
		expect(source).toContain("@acepe/ui");
		expect(source).not.toContain("@font-face");
		expect(source).not.toContain("--background:");
	});

	it("renders the Acepe lockup and card-like slide surfaces", () => {
		const { body } = render(Page);

		expect(body).toContain('aria-label="Acepe"');
		expect(body).toContain("CEPE");
		expect(body).toContain("bg-card");
		expect(body).toContain("border-border/60");
	});
});

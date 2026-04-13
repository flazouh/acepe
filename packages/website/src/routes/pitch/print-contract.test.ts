import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

const { default: Page } = await import("./+page.svelte");

describe("pitch print and navigation contract", () => {
	it("renders previous and next anchors for the presentation flow", () => {
		const { body } = render(Page);
		const titleSectionMarkup = body.split('id="title"')[1]?.split("</section>")[0] ?? "";
		const askSectionMarkup = body.split('id="ask"')[1]?.split("</section>")[0] ?? "";

		expect(body).toContain('data-pitch-next="problem"');
		expect(body).toContain('href="#problem"');
		expect(body).toContain('data-pitch-prev="team"');
		expect(body).toContain('href="#team"');
		expect(body).toContain("data-pitch-print-hidden");
		expect(titleSectionMarkup).not.toContain("data-pitch-prev=");
		expect(titleSectionMarkup).toContain('aria-disabled="true"');
		expect(askSectionMarkup).not.toContain("data-pitch-next=");
		expect(askSectionMarkup).toContain('aria-disabled="true"');
	});

	it("defines the authoritative print page contract in layout.css", async () => {
		const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");

		expect(source).toContain("@page");
		expect(source).toContain("13.333in 7.5in landscape");
		expect(source).toContain("margin: 0");
		expect(source).toContain("[data-pitch-section]");
		expect(source).toContain("break-after: page");
		expect(source).toContain("[data-pitch-print-hidden]");
		expect(source).toContain("display: none !important");
	});
});

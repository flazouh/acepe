import { describe, expect, it } from "vitest";

import { GET } from "./+server";

describe("sitemap.xml", () => {
	it("includes the discoverability and comparison routes", async () => {
		const response = await GET({} as never);
		const xml = await response.text();

		expect(xml).toContain("<loc>https://acepe.dev/pricing</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/blog</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/blog/attention-queue</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/blog/checkpoints</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/blog/sql-studio</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/blog/git-panel</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/blog/git-viewer</loc>");
		expect(xml).toContain(
			"<loc>https://acepe.dev/blog/attention-queue</loc>\n    <lastmod>2026-02-20</lastmod>"
		);
		expect(xml).toContain("<loc>https://acepe.dev/changelog</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/compare</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/compare/cursor</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/compare/superset</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/compare/1code</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/compare/t3</loc>");
		expect(xml).toContain("<loc>https://acepe.dev/compare/conductor</loc>");
		expect(xml).toContain(
			"<loc>https://acepe.dev/compare/1code</loc>\n    <lastmod>2026-04-02</lastmod>"
		);
		expect(xml).toContain(
			"<loc>https://acepe.dev/compare/conductor</loc>\n    <lastmod>2026-04-02</lastmod>"
		);
	});
});

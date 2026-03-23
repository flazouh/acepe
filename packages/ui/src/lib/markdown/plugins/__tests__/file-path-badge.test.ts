import { describe, expect, it } from "bun:test";
import MarkdownIt from "markdown-it";

import { filePathBadgePlugin } from "../file-path-badge.js";

function renderWithPlugin(markdown: string): string {
	const md = MarkdownIt({ html: false, linkify: true, typographer: false });
	md.use(filePathBadgePlugin);
	return md.render(markdown);
}

function expectFileChip(html: string, filePath: string): void {
	expect(html).toContain("file-path-badge-placeholder");
	expect(html).toContain(encodeURIComponent(JSON.stringify({ filePath, locationSuffix: "" })));
}

function expectNoFileChip(html: string): void {
	expect(html).not.toContain("file-path-badge-placeholder");
}

describe("filePathBadgePlugin", () => {
	describe("paths with directory separators (existing behavior)", () => {
		it("renders file chip for relative path in backticks", () => {
			const html = renderWithPlugin("`packages/desktop/src/file.ts`");
			expectFileChip(html, "packages/desktop/src/file.ts");
		});

		it("renders file chip for absolute path in backticks", () => {
			const html = renderWithPlugin("`/Users/alex/file.ts`");
			expectFileChip(html, "/Users/alex/file.ts");
		});

		it("renders file chip for path with line number in backticks", () => {
			const html = renderWithPlugin("`packages/desktop/src/file.ts:42`");
			expect(html).toContain("file-path-badge-placeholder");
			expect(html).toContain(
				encodeURIComponent(
					JSON.stringify({ filePath: "packages/desktop/src/file.ts", locationSuffix: ":42" })
				)
			);
		});

		it("renders file chip for plain text path", () => {
			const html = renderWithPlugin("See packages/desktop/src/file.ts for details");
			expectFileChip(html, "packages/desktop/src/file.ts");
		});

		it("renders file chip for plain text path with line number", () => {
			const html = renderWithPlugin("See packages/desktop/src/file.ts:42 for details");
			expect(html).toContain("file-path-badge-placeholder");
			expect(html).toContain(
				encodeURIComponent(
					JSON.stringify({ filePath: "packages/desktop/src/file.ts", locationSuffix: ":42" })
				)
			);
		});

		it("renders multiple file chips in one line", () => {
			const html = renderWithPlugin(
				"See `file.ts` and `other.svelte` for details"
			);
			const count = (html.match(/file-path-badge-placeholder/g) ?? []).length;
			expect(count).toBe(2);
		});
	});

	describe("bare filenames in backticks", () => {
		it("renders file chip for bare .md filename", () => {
			const html = renderWithPlugin("`CLAUDE.md`");
			expectFileChip(html, "CLAUDE.md");
		});

		it("renders file chip for bare .ts filename", () => {
			const html = renderWithPlugin("`index.ts`");
			expectFileChip(html, "index.ts");
		});

		it("renders file chip for bare .json filename", () => {
			const html = renderWithPlugin("`package.json`");
			expectFileChip(html, "package.json");
		});

		it("renders file chip for bare .svelte filename", () => {
			const html = renderWithPlugin("`App.svelte`");
			expectFileChip(html, "App.svelte");
		});

		it("renders file chip for bare filename with line number", () => {
			const html = renderWithPlugin("`file.ts:42`");
			expect(html).toContain("file-path-badge-placeholder");
			expect(html).toContain(
				encodeURIComponent(JSON.stringify({ filePath: "file.ts", locationSuffix: ":42" }))
			);
		});

		it("renders file chip for bare filename with line and column", () => {
			const html = renderWithPlugin("`file.ts:42:10`");
			expect(html).toContain("file-path-badge-placeholder");
			expect(html).toContain(
				encodeURIComponent(JSON.stringify({ filePath: "file.ts", locationSuffix: ":42:10" }))
			);
		});

		it("renders file chip for bare filename inside bold", () => {
			const html = renderWithPlugin("**`CLAUDE.md`**");
			expectFileChip(html, "CLAUDE.md");
		});

		it("renders file chip for dotfile", () => {
			const html = renderWithPlugin("`.gitignore`");
			expectFileChip(html, ".gitignore");
		});

		it("renders file chip for .env file", () => {
			const html = renderWithPlugin("`.env`");
			expectFileChip(html, ".env");
		});

		it("renders file chip for .pdf filename", () => {
			const html = renderWithPlugin("`media_report.pdf`");
			expectFileChip(html, "media_report.pdf");
		});

		it("renders file chip for .png filename", () => {
			const html = renderWithPlugin("`screenshot.png`");
			expectFileChip(html, "screenshot.png");
		});

		it("renders file chip for known extension", () => {
			const html = renderWithPlugin("`data.parquet`");
			expectFileChip(html, "data.parquet");
		});
	});

	describe("markdown links to local files (should replace with badge)", () => {
		it("replaces link to local file with badge", () => {
			const html = renderWithPlugin("[`CLAUDE.md`](./CLAUDE.md)");
			expectFileChip(html, "./CLAUDE.md");
			expect(html).not.toContain("<a");
		});

		it("replaces link to local path with badge", () => {
			const html = renderWithPlugin("[`src/file.ts`](src/file.ts)");
			expectFileChip(html, "src/file.ts");
			expect(html).not.toContain("<a");
		});

		it("replaces text link to local path with badge", () => {
			const html = renderWithPlugin("[src/file.ts](src/file.ts)");
			expectFileChip(html, "src/file.ts");
			expect(html).not.toContain(">src/file.ts<");
		});

		it("replaces link with #L line number fragment", () => {
			const html = renderWithPlugin(
				"[file.ts:42](packages/desktop/src/file.ts#L42)"
			);
			expect(html).toContain("file-path-badge-placeholder");
			expect(html).toContain(
				encodeURIComponent(
					JSON.stringify({
						filePath: "packages/desktop/src/file.ts",
						locationSuffix: ":42",
					})
				)
			);
			expect(html).not.toContain("<a");
		});

		it("replaces backtick link with #L line number fragment", () => {
			const html = renderWithPlugin(
				"[`session-list-ui.svelte:123`](src/lib/session-list-ui.svelte#L123)"
			);
			expect(html).toContain("file-path-badge-placeholder");
			expect(html).toContain(
				encodeURIComponent(
					JSON.stringify({
						filePath: "src/lib/session-list-ui.svelte",
						locationSuffix: ":123",
					})
				)
			);
		});

		it("replaces local file link without #L fragment", () => {
			const html = renderWithPlugin("[click here](src/lib/file.ts)");
			expectFileChip(html, "src/lib/file.ts");
			expect(html).not.toContain("<a");
			expect(html).not.toContain(">click here<");
		});

		it("preserves spacing when replacing markdown link with badge", () => {
			const html = renderWithPlugin("before [src/file.ts](src/file.ts) after");
			expectFileChip(html, "src/file.ts");
			expect(html).toContain("</span> after");
			expect(html).not.toContain(">src/file.ts<");
		});

		it("does NOT replace link to non-file local path", () => {
			const html = renderWithPlugin("[section](#heading)");
			expectNoFileChip(html);
		});

		it("does NOT replace link with non-file href", () => {
			const html = renderWithPlugin("[text](some-page)");
			expectNoFileChip(html);
		});
	});

	describe("markdown links to URLs (should NOT replace)", () => {
		it("does NOT replace https links", () => {
			const html = renderWithPlugin("[docs](https://example.com/file.ts)");
			expectNoFileChip(html);
			expect(html).toContain("<a");
		});

		it("does NOT replace http links", () => {
			const html = renderWithPlugin("[docs](http://example.com/file.ts)");
			expectNoFileChip(html);
		});

		it("does NOT replace mailto links", () => {
			const html = renderWithPlugin("[email](mailto:test@test.com)");
			expectNoFileChip(html);
		});
	});

	describe("false positive prevention", () => {
		it("does NOT render file chip for version numbers", () => {
			const html = renderWithPlugin("`v1.0`");
			expectNoFileChip(html);
		});

		it("does NOT render file chip for numeric extensions", () => {
			const html = renderWithPlugin("`data.123`");
			expectNoFileChip(html);
		});

		it("does NOT render file chip for class references (PascalCase after dot)", () => {
			const html = renderWithPlugin("`React.Component`");
			expectNoFileChip(html);
		});

		it("does NOT render file chip for uppercase extensions", () => {
			const html = renderWithPlugin("`Module.Export`");
			expectNoFileChip(html);
		});

		it("does NOT render file chip for unknown extension", () => {
			const html = renderWithPlugin("`input.name`");
			expectNoFileChip(html);
		});

		it("does NOT replace local link with unknown extension", () => {
			const html = renderWithPlugin("[input.name](input.name)");
			expectNoFileChip(html);
			expect(html).toContain("<a");
		});
	});
});

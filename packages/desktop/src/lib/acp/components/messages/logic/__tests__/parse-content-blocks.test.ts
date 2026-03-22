import { describe, expect, it } from "bun:test";

import { parseContentBlocks } from "../parse-content-blocks.js";

describe("parseContentBlocks", () => {
	it("should return single HTML block when no placeholders", () => {
		const html = "<p>Hello world</p>";
		const blocks = parseContentBlocks(html);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toEqual({ type: "html", content: html });
	});

	it("should return empty blocks for empty string", () => {
		const blocks = parseContentBlocks("");
		expect(blocks).toHaveLength(0);
	});

	it("should extract mermaid placeholder", () => {
		const html = `<p>Before</p><div class="mermaid-placeholder" data-mermaid-code="flowchart%20LR"></div><p>After</p>`;
		const blocks = parseContentBlocks(html);
		expect(blocks).toHaveLength(3);
		expect(blocks[0]).toEqual({ type: "html", content: "<p>Before</p>" });
		expect(blocks[1]).toEqual({ type: "mermaid", code: "flowchart LR" });
		expect(blocks[2]).toEqual({ type: "html", content: "<p>After</p>" });
	});

	it("should extract pierre file placeholder", () => {
		const code = encodeURIComponent("const x = 1;");
		const lang = encodeURIComponent("typescript");
		const html = `<div class="pierre-file-placeholder" data-pierre-code="${code}" data-pierre-lang="${lang}"></div>`;
		const blocks = parseContentBlocks(html);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toEqual({
			type: "pierre_file",
			code: "const x = 1;",
			lang: "typescript",
		});
	});

	it("should treat file path badge placeholder as plain html (replaced before splitting)", () => {
		const ref = encodeURIComponent(
			JSON.stringify({ filePath: "/path/to/file.ts", locationSuffix: ":10" })
		);
		const html = `<span class="file-path-badge-placeholder" data-file-ref="${ref}"></span>`;
		const blocks = parseContentBlocks(html);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("html");
	});

	it("should keep GitHub badge placeholder in html (inline span, same as file-path-badge)", () => {
		const ref = encodeURIComponent(JSON.stringify({ type: "commit", sha: "abc1234" }));
		const html = `<span class="github-badge-placeholder" data-github-ref="${ref}"></span>`;
		const blocks = parseContentBlocks(html);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("html");
		expect((blocks[0] as { type: "html"; content: string }).content).toContain(
			'class="github-badge-placeholder"'
		);
	});

	it("should merge multiple block types in order", () => {
		const mermaidPlaceholder = '<div class="mermaid-placeholder" data-mermaid-code="x"></div>';
		const pierrePlaceholder =
			'<div class="pierre-file-placeholder" data-pierre-code="y" data-pierre-lang=""></div>';
		const html = `<p>A</p>${mermaidPlaceholder}<p>B</p>${pierrePlaceholder}<p>C</p>`;
		const blocks = parseContentBlocks(html);
		expect(blocks).toHaveLength(5);
		expect(blocks[0]).toEqual({ type: "html", content: "<p>A</p>" });
		expect(blocks[1]).toEqual({ type: "mermaid", code: "x" });
		expect(blocks[2]).toEqual({ type: "html", content: "<p>B</p>" });
		expect(blocks[3]).toEqual({ type: "pierre_file", code: "y", lang: null });
		expect(blocks[4]).toEqual({ type: "html", content: "<p>C</p>" });
	});

	it("should treat any file path badge placeholder as html (no longer in registry)", () => {
		const ref = encodeURIComponent(JSON.stringify({ locationSuffix: "" }));
		const html = `<span class="file-path-badge-placeholder" data-file-ref="${ref}"></span>`;
		const blocks = parseContentBlocks(html);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("html");
	});

	it("should keep invalid GitHub badge placeholder in html (no block extraction)", () => {
		const ref = encodeURIComponent(JSON.stringify({ type: "unknown" }));
		const html = `<span class="github-badge-placeholder" data-github-ref="${ref}"></span>`;
		const blocks = parseContentBlocks(html);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("html");
	});
});

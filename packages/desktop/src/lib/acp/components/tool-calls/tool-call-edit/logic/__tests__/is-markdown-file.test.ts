import { describe, expect, it } from "bun:test";

import { isMarkdownFile } from "../is-markdown-file.js";

describe("isMarkdownFile", () => {
	it("should return true for .md files", () => {
		expect(isMarkdownFile("README.md")).toBe(true);
		expect(isMarkdownFile("docs/guide.md")).toBe(true);
		expect(isMarkdownFile("file.MD")).toBe(true);
	});

	it("should return true for .mdx files", () => {
		expect(isMarkdownFile("component.mdx")).toBe(true);
		expect(isMarkdownFile("docs/page.MDX")).toBe(true);
	});

	it("should return true for .markdown files", () => {
		expect(isMarkdownFile("readme.markdown")).toBe(true);
		expect(isMarkdownFile("docs/guide.MARKDOWN")).toBe(true);
	});

	it("should return false for non-markdown files", () => {
		expect(isMarkdownFile("file.txt")).toBe(false);
		expect(isMarkdownFile("script.js")).toBe(false);
		expect(isMarkdownFile("style.css")).toBe(false);
		expect(isMarkdownFile("component.tsx")).toBe(false);
	});

	it("should return false for null file path", () => {
		expect(isMarkdownFile(null)).toBe(false);
	});

	it("should return false for empty string", () => {
		expect(isMarkdownFile("")).toBe(false);
	});

	it("should return false for files without extension", () => {
		expect(isMarkdownFile("README")).toBe(false);
		expect(isMarkdownFile("file")).toBe(false);
	});

	it("should handle case-insensitive extensions", () => {
		expect(isMarkdownFile("file.MD")).toBe(true);
		expect(isMarkdownFile("file.MDX")).toBe(true);
		expect(isMarkdownFile("file.MARKDOWN")).toBe(true);
		expect(isMarkdownFile("file.md")).toBe(true);
		expect(isMarkdownFile("file.mdx")).toBe(true);
		expect(isMarkdownFile("file.markdown")).toBe(true);
	});

	it("should handle paths with multiple dots", () => {
		expect(isMarkdownFile("file.name.md")).toBe(true);
		expect(isMarkdownFile("file.name.txt")).toBe(false);
	});

	it("should handle absolute paths", () => {
		expect(isMarkdownFile("/home/user/docs/readme.md")).toBe(true);
		expect(isMarkdownFile("C:\\Users\\docs\\readme.md")).toBe(true);
	});
});

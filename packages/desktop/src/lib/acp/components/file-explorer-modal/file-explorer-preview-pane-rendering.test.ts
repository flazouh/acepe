import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const filePath = resolve(__dirname, "./file-explorer-preview-pane.svelte");
const source = readFileSync(filePath, "utf8");

describe("file explorer preview pane source", () => {
	it("renders markdown previews with the markdown renderer", () => {
		expect(source).toContain('preview.language_hint === "markdown"');
		expect(source).toContain("isMarkdownInitialized()");
		expect(source).toContain("renderMarkdownSync(");
		expect(source).toContain("{@html markdownHtml}");
	});

	it("falls back explicitly when markdown HTML is unavailable", () => {
		expect(source).toContain(
			'{:else if props.preview.kind === "text" && isMarkdownPreview && textFallbackContent !== null}'
		);
		expect(source).toContain("textFallbackContent");
	});

	it("keeps non-markdown text previews on the Pierre rendering path", () => {
		expect(source).toContain('if (props.preview.kind === "text") {');
		expect(source).toContain("oldContent: props.preview.content");
		expect(source).toContain("newContent: props.preview.content");
		expect(source).not.toContain(
			'{:else if props.preview.kind === "text" && textFallbackContent !== null}'
		);
	});

	it("shows plain-text fallback content instead of a raw render error", () => {
		expect(source).toContain("textFallbackContent");
		expect(source).not.toContain("{renderError}");
	});
});

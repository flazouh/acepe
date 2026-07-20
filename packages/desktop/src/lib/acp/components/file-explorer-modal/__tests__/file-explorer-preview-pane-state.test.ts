import { describe, expect, it } from "bun:test";
import type { FileExplorerPreviewResponse } from "$lib/services/converted-session-types.js";
import {
	buildFileExplorerDiffInput,
	getFileExplorerCodePreviewLanguage,
	getFileExplorerFallbackMessage,
	getFileExplorerTextFallbackContent,
	isFileExplorerMarkdownPreview,
	shouldRenderFileExplorerPlainText,
} from "../file-explorer-preview-pane-state.js";

const gitStatus = {
	path: "src/app.ts",
	status: "modified",
	insertions: 1,
	deletions: 0,
} as const;

function textPreview(
	overrides: Partial<Extract<FileExplorerPreviewResponse, { kind: "text" }>> = {}
): Extract<FileExplorerPreviewResponse, { kind: "text" }> {
	return {
		kind: "text",
		file_path: "README.md",
		file_name: "README.md",
		content: "# Hello",
		language_hint: null,
		...overrides,
	};
}

function diffPreview(
	overrides: Partial<Extract<FileExplorerPreviewResponse, { kind: "diff" }>> = {}
): Extract<FileExplorerPreviewResponse, { kind: "diff" }> {
	return {
		kind: "diff",
		file_path: "src/app.ts",
		file_name: "app.ts",
		old_content: "before",
		new_content: "after",
		git_status: gitStatus,
		...overrides,
	};
}

function fallbackPreview(
	previewKind: Extract<FileExplorerPreviewResponse, { kind: "fallback" }>["preview_kind"]
): Extract<FileExplorerPreviewResponse, { kind: "fallback" }> {
	return {
		kind: "fallback",
		file_path: "image.png",
		file_name: "image.png",
		reason: "binary",
		size_bytes: 10,
		git_status: null,
		preview_kind: previewKind,
	};
}

describe("file explorer preview pane state", () => {
	it("detects markdown text previews", () => {
		expect(isFileExplorerMarkdownPreview(textPreview())).toBe(true);
		expect(
			isFileExplorerMarkdownPreview(
				textPreview({ file_name: "notes.txt", language_hint: "markdown" })
			)
		).toBe(true);
		expect(isFileExplorerMarkdownPreview(textPreview({ file_name: "app.ts" }))).toBe(false);
		expect(isFileExplorerMarkdownPreview(diffPreview())).toBe(false);
	});

	it("gets fallback content for text and diff previews", () => {
		expect(getFileExplorerTextFallbackContent(textPreview({ content: "hello" }))).toBe("hello");
		expect(getFileExplorerTextFallbackContent(diffPreview({ new_content: "after" }))).toBe("after");
		expect(getFileExplorerTextFallbackContent(fallbackPreview("binary"))).toBeNull();
	});

	it("decides when plain text rendering is requested", () => {
		expect(
			shouldRenderFileExplorerPlainText({ preview: textPreview(), preferPlainText: true })
		).toBe(true);
		expect(
			shouldRenderFileExplorerPlainText({ preview: diffPreview(), preferPlainText: true })
		).toBe(true);
		expect(
			shouldRenderFileExplorerPlainText({
				preview: fallbackPreview("large"),
				preferPlainText: true,
			})
		).toBe(false);
		expect(
			shouldRenderFileExplorerPlainText({ preview: textPreview(), preferPlainText: false })
		).toBe(false);
	});

	it("resolves code preview language", () => {
		expect(getFileExplorerCodePreviewLanguage(null)).toBe("plaintext");
		expect(getFileExplorerCodePreviewLanguage(textPreview({ language_hint: "markdown" }))).toBe(
			"markdown"
		);
		expect(getFileExplorerCodePreviewLanguage(diffPreview())).toBe("typescript");
		expect(getFileExplorerCodePreviewLanguage(fallbackPreview("deleted"))).toBe("plaintext");
	});

	it("builds diff inputs for diff and text previews", () => {
		expect(
			buildFileExplorerDiffInput({
				preview: diffPreview({ old_content: null, new_content: "after" }),
				shouldRenderPlainText: false,
				isMarkdownPreview: false,
			})
		).toEqual({
			fileName: "app.ts",
			oldContent: "",
			newContent: "after",
		});
		expect(
			buildFileExplorerDiffInput({
				preview: textPreview({ file_name: "app.ts", content: "same" }),
				shouldRenderPlainText: false,
				isMarkdownPreview: false,
			})
		).toEqual({
			fileName: "app.ts",
			oldContent: "same",
			newContent: "same",
		});
		expect(
			buildFileExplorerDiffInput({
				preview: textPreview(),
				shouldRenderPlainText: false,
				isMarkdownPreview: true,
			})
		).toBeNull();
	});

	it("maps fallback preview kinds to messages", () => {
		expect(getFileExplorerFallbackMessage(fallbackPreview("binary"))).toBe(
			"Binary file - cannot display preview"
		);
		expect(getFileExplorerFallbackMessage(fallbackPreview("large"))).toBe(
			"File is too large to preview"
		);
		expect(getFileExplorerFallbackMessage(fallbackPreview("deleted"))).toBe(
			"File has been deleted"
		);
		expect(getFileExplorerFallbackMessage(null)).toBeNull();
	});
});

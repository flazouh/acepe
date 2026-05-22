import { getLanguageFromFilename } from "$lib/components/ui/codemirror-editor/language-loader.js";
import type { FileExplorerPreviewResponse } from "$lib/services/converted-session-types.js";

export type FileExplorerDiffInput = {
	fileName: string;
	oldContent: string;
	newContent: string;
};

export function isFileExplorerMarkdownPreview(
	preview: FileExplorerPreviewResponse | null
): boolean {
	if (preview === null || preview.kind !== "text") return false;
	if (preview.language_hint === "markdown") return true;
	return preview.file_name.toLowerCase().endsWith(".md");
}

export function getFileExplorerTextFallbackContent(
	preview: FileExplorerPreviewResponse | null
): string | null {
	if (preview === null) return null;
	if (preview.kind === "diff") return preview.new_content;
	if (preview.kind !== "text") return null;
	return preview.content;
}

export function shouldRenderFileExplorerPlainText(input: {
	readonly preview: FileExplorerPreviewResponse | null;
	readonly preferPlainText: boolean;
}): boolean {
	if (!input.preferPlainText) return false;
	if (input.preview === null) return false;
	return input.preview.kind === "text" || input.preview.kind === "diff";
}

export function getFileExplorerCodePreviewLanguage(
	preview: FileExplorerPreviewResponse | null
): string {
	if (preview === null) return "plaintext";
	if (preview.kind === "text" && preview.language_hint !== null) {
		return preview.language_hint;
	}
	if (preview.kind === "text" || preview.kind === "diff") {
		return getLanguageFromFilename(preview.file_name);
	}
	return "plaintext";
}

export function buildFileExplorerDiffInput(input: {
	readonly preview: FileExplorerPreviewResponse | null;
	readonly shouldRenderPlainText: boolean;
	readonly isMarkdownPreview: boolean;
}): FileExplorerDiffInput | null {
	const { preview } = input;
	if (preview === null) return null;
	if (input.shouldRenderPlainText) return null;
	if (input.isMarkdownPreview) return null;
	if (preview.kind === "diff") {
		return {
			fileName: preview.file_name,
			oldContent: preview.old_content !== null ? preview.old_content : "",
			newContent: preview.new_content,
		};
	}
	if (preview.kind === "text") {
		return {
			fileName: preview.file_name,
			oldContent: preview.content,
			newContent: preview.content,
		};
	}
	return null;
}

export function getFileExplorerFallbackMessage(
	preview: FileExplorerPreviewResponse | null
): string | null {
	if (preview === null) return null;
	if (preview.kind !== "fallback") return null;
	if (preview.preview_kind === "binary") return "Binary file - cannot display preview";
	if (preview.preview_kind === "large") return "File is too large to preview";
	if (preview.preview_kind === "deleted") return "File has been deleted";
	return "Preview unavailable";
}

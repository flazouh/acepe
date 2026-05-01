import { MARKDOWN_EXTENSIONS } from "../constants/markdown-extensions.js";

/**
 * Determines if a file path represents a markdown file.
 *
 * Checks the file extension against known markdown extensions.
 * Case-insensitive comparison.
 *
 * @param filePath - The file path to check, or null
 * @returns True if the file is a markdown file, false otherwise
 */
export function isMarkdownFile(filePath: string | null): boolean {
	if (!filePath) {
		return false;
	}

	const ext = filePath.toLowerCase().split(".").pop();
	if (!ext) {
		return false;
	}

	return MARKDOWN_EXTENSIONS.includes(ext as (typeof MARKDOWN_EXTENSIONS)[number]);
}

import type { ToolCall } from "../../../types/tool-call.js";
import { calculateDiffStats, getFileName } from "../../../utils/file-utils.js";
import type { FileInfo } from "../types/file-info.js";
import { isMarkdownFile } from "./is-markdown-file.js";

/**
 * Creates FileInfo from a tool call.
 *
 * Extracts file path, file name, diff statistics, and determines
 * if the file is a markdown file.
 *
 * @param toolCall - The tool call to extract file info from
 * @returns FileInfo object with extracted metadata
 */
export function createFileInfo(toolCall: ToolCall): FileInfo {
	const argumentPath =
		toolCall.arguments.kind === "edit" ? (toolCall.arguments.edits[0]?.filePath ?? null) : null;
	const locationPath = toolCall.locations?.[0]?.path ?? null;
	const filePath = argumentPath ?? locationPath;
	const fileName = getFileName(filePath);
	const firstEdit =
		toolCall.arguments.kind === "edit" ? (toolCall.arguments.edits[0] ?? null) : null;
	const diffStats = calculateDiffStats(firstEdit);
	const isMarkdown = isMarkdownFile(filePath);

	return {
		filePath,
		fileName,
		diffStats,
		isMarkdown,
	};
}

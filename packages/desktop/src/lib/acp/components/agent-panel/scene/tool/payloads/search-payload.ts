import type { ToolCall } from "../../../../../types/tool-call.js";
import { isSearchNormalizedResult } from "../tool-result.js";

export function mapSearchPayload(toolCall: ToolCall): {
	searchFiles?: string[];
	searchResultCount?: number;
	searchMode?: "content" | "files" | "count";
	searchNumFiles?: number;
	searchNumMatches?: number;
	searchMatches?: {
		filePath: string;
		fileName: string;
		lineNumber: number;
		content: string;
		isMatch: boolean;
	}[];
} {
	if (toolCall.arguments.kind === "search") {
		const normalizedResult = isSearchNormalizedResult(toolCall.normalizedResult)
			? toolCall.normalizedResult
			: null;
		if (normalizedResult === null) {
			return {};
		}

		return {
			searchFiles: Array.from(normalizedResult.files),
			searchResultCount:
				normalizedResult.mode === "content"
					? (normalizedResult.numMatches ?? normalizedResult.numFiles)
					: normalizedResult.files.length,
			searchMode: normalizedResult.mode,
			searchNumFiles: normalizedResult.numFiles,
			searchNumMatches: normalizedResult.numMatches,
			searchMatches: normalizedResult.matches.map((match) => ({
				filePath: match.filePath,
				fileName: match.fileName,
				lineNumber: match.lineNumber,
				content: match.content,
				isMatch: match.isMatch,
			})),
		};
	}

	if (toolCall.arguments.kind !== "glob") {
		return {};
	}

	const rawResult = toolCall.result;
	if (Array.isArray(rawResult)) {
		const files = rawResult.filter((value): value is string => typeof value === "string");
		return {
			searchFiles: files,
			searchResultCount: files.length,
		};
	}

	if (rawResult === null || rawResult === undefined || typeof rawResult !== "object") {
		return {};
	}

	const filenames = Array.isArray(rawResult.filenames)
		? rawResult.filenames.filter((value): value is string => typeof value === "string")
		: [];
	const totalFiles =
		typeof rawResult.totalFiles === "number"
			? rawResult.totalFiles
			: typeof rawResult.numFiles === "number"
				? rawResult.numFiles
				: filenames.length;

	return {
		searchFiles: filenames,
		searchResultCount: totalFiles,
	};
}

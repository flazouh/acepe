import type { SessionEntry } from "../application/dto/session.js";
import type { ModifiedFileEntry } from "../types/modified-file-entry.js";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import type { ToolCall } from "../types/tool-call.js";
import { TOOL_KINDS } from "../types/tool-kind.js";
import { calculateDiffStats, getFileName } from "../utils/file-utils.js";

/**
 * Extracts file path from tool call arguments.
 * Uses the normalized discriminated union.
 */
function extractFilePath(toolCall: ToolCall): string | null {
	// Check different tool kinds that have file paths
	switch (toolCall.arguments.kind) {
		case "read":
		case "edit":
		case "delete":
			return toolCall.arguments.file_path ?? null;
		case "search":
			return toolCall.arguments.file_path ?? null; // optional for search
		case "glob":
			return toolCall.arguments.path ?? null;
		default:
			return null;
	}
}

function collectToolCallsRecursive(toolCall: ToolCall, result: ToolCall[]): void {
	result.push(toolCall);
	const children = toolCall.taskChildren;
	if (!children || children.length === 0) {
		return;
	}
	for (const child of children) {
		collectToolCallsRecursive(child, result);
	}
}

function collectAllToolCalls(entries: ReadonlyArray<SessionEntry>): ToolCall[] {
	const result: ToolCall[] = [];
	for (const entry of entries) {
		if (entry.type !== "tool_call") {
			continue;
		}
		collectToolCallsRecursive(entry.message, result);
	}
	return result;
}

type FileAccumulator = {
	filePath: string;
	fileName: string;
	totalAdded: number;
	totalRemoved: number;
	originalContent: string | null;
	finalContent: string | null;
	editCount: number;
};

/**
 * Aggregates all edit tool calls from session entries into per-file statistics.
 */
export function aggregateFileEdits(entries: ReadonlyArray<SessionEntry>): ModifiedFilesState {
	const fileMap = new Map<string, FileAccumulator>();
	const allToolCalls = collectAllToolCalls(entries);
	const editToolCalls = allToolCalls.filter((toolCall) => toolCall.kind === TOOL_KINDS.EDIT);

	for (const toolCall of editToolCalls) {
		const filePath = extractFilePath(toolCall);

		if (!filePath) continue;

		const diffStats = calculateDiffStats(toolCall.arguments);

		// Safely extract string properties from arguments (which is JsonValue)
		const args =
			toolCall.arguments &&
			typeof toolCall.arguments === "object" &&
			!Array.isArray(toolCall.arguments)
				? (toolCall.arguments as Record<string, unknown>)
				: null;
		const oldString = args?.old_string;
		const newString = args?.new_string;
		const content = args?.content;

		const oldStringValue = typeof oldString === "string" ? oldString : null;
		const newStringValue =
			typeof newString === "string" ? newString : typeof content === "string" ? content : null;

		const linesAdded = diffStats?.added ?? 0;
		const linesRemoved = diffStats?.removed ?? 0;

		const existing = fileMap.get(filePath);

		if (existing) {
			existing.totalAdded += linesAdded;
			existing.totalRemoved += linesRemoved;
			existing.finalContent = newStringValue;
			existing.editCount += 1;
		} else {
			fileMap.set(filePath, {
				filePath,
				fileName: getFileName(filePath),
				totalAdded: linesAdded,
				totalRemoved: linesRemoved,
				originalContent: oldStringValue,
				finalContent: newStringValue,
				editCount: 1,
			});
		}
	}

	// Build both array and map in single pass
	const files: ModifiedFileEntry[] = [];
	const byPath = new Map<string, ModifiedFileEntry>();

	for (const acc of fileMap.values()) {
		const entry: ModifiedFileEntry = {
			filePath: acc.filePath,
			fileName: acc.fileName,
			totalAdded: acc.totalAdded,
			totalRemoved: acc.totalRemoved,
			originalContent: acc.originalContent,
			finalContent: acc.finalContent,
			editCount: acc.editCount,
		};
		files.push(entry);
		byPath.set(entry.filePath, entry);
	}

	files.sort((a, b) => a.fileName.length - b.fileName.length);

	return {
		files,
		byPath,
		fileCount: files.length,
		totalEditCount: editToolCalls.length,
	};
}

import type { EditEntry } from "../../services/converted-session-types.js";
import type { SessionEntry } from "../application/dto/session.js";
import type { ModifiedFileEntry } from "../types/modified-file-entry.js";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import type { ToolCall } from "../types/tool-call.js";
import { calculateDiffStats, getFileName } from "../utils/file-utils.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function readStringProperty(
	value: Record<string, unknown>,
	primaryKey: string,
	fallbackKey: string
): string | null {
	if (primaryKey in value) {
		return readOptionalString(value[primaryKey]);
	}

	if (fallbackKey in value) {
		return readOptionalString(value[fallbackKey]);
	}

	return null;
}

function normalizeEditEntry(value: unknown): EditEntry | null {
	if (!isRecord(value)) {
		return null;
	}

	const filePath = readStringProperty(value, "filePath", "file_path");
	const oldString = readStringProperty(value, "oldString", "old_string");
	const newString = readStringProperty(value, "newString", "new_string");
	const content = readOptionalString(value.content);

	if (filePath === null && oldString === null && newString === null && content === null) {
		return null;
	}

	return {
		filePath,
		oldString,
		newString,
		content,
	};
}

function extractEditEntries(toolCall: ToolCall): EditEntry[] {
	const argumentsValue = toolCall.arguments as unknown;
	if (!isRecord(argumentsValue)) {
		return [];
	}

	if ("edits" in argumentsValue && Array.isArray(argumentsValue.edits)) {
		const edits: EditEntry[] = [];
		for (const entry of argumentsValue.edits) {
			const normalizedEntry = normalizeEditEntry(entry);
			if (normalizedEntry) {
				edits.push(normalizedEntry);
			}
		}
		return edits;
	}

	const legacyEntry = normalizeEditEntry(argumentsValue);
	return legacyEntry ? [legacyEntry] : [];
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
	const editToolCalls = allToolCalls.filter((toolCall) => toolCall.kind === "edit");
	let validEditToolCallCount = 0;

	for (const toolCall of editToolCalls) {
		const editEntries = extractEditEntries(toolCall);
		if (editEntries.length === 0) continue;
		validEditToolCallCount += 1;

		for (const edit of editEntries) {
			const filePath = edit.filePath;
			if (!filePath) continue;

			const oldStringValue = edit.oldString ?? null;
			const newStringValue = edit.newString ?? edit.content ?? null;

			const diffStats = calculateDiffStats(edit);
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
		totalEditCount: validEditToolCallCount,
	};
}

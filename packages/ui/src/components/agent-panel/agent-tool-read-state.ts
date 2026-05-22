import type { AgentToolStatus } from "./types.js";

export const READ_EXPANSION_STORAGE_PREFIX =
	"acepe:agent-tool-read-expanded:";

export function isReadPending(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

export function getReadHeaderLabel(
	status: AgentToolStatus,
	labels: {
		runningLabel: string;
		doneLabel: string;
	}
): string {
	return isReadPending(status) ? labels.runningLabel : labels.doneLabel;
}

export function getReadFileName(input: {
	filePath?: string | null;
	fileName?: string | null;
}): string | null {
	if (input.fileName) return input.fileName;
	if (!input.filePath) return null;
	return input.filePath.split("/").pop() ?? input.filePath;
}

export function hasReadSourceExcerptHtml(
	sourceExcerptHtml?: string | null
): boolean {
	return typeof sourceExcerptHtml === "string" && sourceExcerptHtml.length > 0;
}

export function hasReadSourceBody(input: {
	sourceRangeLabel?: string | null;
	sourceExcerpt?: string | null;
}): boolean {
	return Boolean(input.sourceRangeLabel || input.sourceExcerpt);
}

export function getReadExpansionStorageKey(
	input: {
		toolCallId?: string | null;
		filePath?: string | null;
	}
): string | null {
	const stableId = input.toolCallId ?? input.filePath;
	if (!stableId) return null;
	return `${READ_EXPANSION_STORAGE_PREFIX}${stableId}`;
}

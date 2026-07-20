import type { AgentToolEditDiffEntry } from "@acepe/ui/agent-panel/types";
import type { ToolCall } from "../../../../../types/tool-call.js";
import { calculateDiffStats, getFileName } from "../../../../../utils/file-utils.js";
import { resolveToolCallEditDiffs } from "../../../../../utils/tool-call-edit/logic/resolve-tool-call-edit-diffs.js";

export function normalizeNullableFilePath(value: string | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function mapEditDiffEntriesForToolCall(
	toolCall: ToolCall
): readonly AgentToolEditDiffEntry[] {
	const resolved = resolveToolCallEditDiffs(
		toolCall.arguments,
		toolCall.progressiveArguments ?? null
	);
	const locationPath = normalizeNullableFilePath(toolCall.locations?.[0]?.path ?? null);

	return resolved.map((diff, index): AgentToolEditDiffEntry => {
		const filePath =
			normalizeNullableFilePath(diff.filePath) ?? (index === 0 ? locationPath : null);
		const oldString = diff.oldString ?? null;
		const newString = diff.newString ?? null;
		const stats = calculateDiffStats({
			oldString: oldString ?? "",
			newString: newString ?? "",
		});
		const additions = stats?.added ?? 0;
		const deletions = stats?.removed ?? 0;

		return {
			filePath,
			fileName: filePath ? getFileName(filePath) : null,
			additions,
			deletions,
			oldString,
			newString,
		};
	});
}

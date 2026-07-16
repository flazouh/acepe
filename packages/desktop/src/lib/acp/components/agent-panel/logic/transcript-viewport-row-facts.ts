import type { TranscriptViewportRow } from "$lib/services/acp-types.js";

export function hasTrailingCompletedTool(
	rows: readonly TranscriptViewportRow[]
): boolean {
	const trailingRow = rows[rows.length - 1];
	if (trailingRow?.kind !== "tool" || trailingRow.operationLinks.length === 0) {
		return false;
	}
	for (const operationLink of trailingRow.operationLinks) {
		if (operationLink.state !== "completed") {
			return false;
		}
	}
	return true;
}

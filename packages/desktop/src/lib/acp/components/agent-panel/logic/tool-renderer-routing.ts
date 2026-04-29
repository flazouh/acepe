import type { SessionEntry } from "../../../application/dto/session.js";

export function shouldUseOptimisticDesktopToolRenderer(
	_entry: Extract<SessionEntry, { type: "tool_call" }>,
	hasCanonicalSceneEntries: boolean
): boolean {
	return !hasCanonicalSceneEntries;
}

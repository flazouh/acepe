import type { SessionEntry } from "../../../application/dto/session.js";

export function shouldUseDesktopToolRenderer(
	_entry: Extract<SessionEntry, { type: "tool_call" }>
): boolean {
	return true;
}

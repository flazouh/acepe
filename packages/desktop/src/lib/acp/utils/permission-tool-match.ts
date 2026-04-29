import type { SessionEntry } from "../application/dto/session-entry.js";
import { isToolCallEntry } from "../application/dto/session-entry.js";
import type { PermissionRequest } from "../types/permission.js";
import type { ToolCall } from "../types/tool-call.js";

export function permissionMatchesToolCall(
	permission: PermissionRequest,
	toolCall: ToolCall
): boolean {
	return permission.tool?.callID === toolCall.id;
}

export function permissionMatchesAnyToolCall(
	permission: PermissionRequest,
	entries: ReadonlyArray<SessionEntry>
): boolean {
	for (const entry of entries) {
		if (!isToolCallEntry(entry)) {
			continue;
		}

		if (permissionMatchesToolCall(permission, entry.message)) {
			return true;
		}
	}

	return false;
}

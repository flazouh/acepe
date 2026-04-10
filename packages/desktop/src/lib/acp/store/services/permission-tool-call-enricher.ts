import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCallUpdate } from "../../types/tool-call.js";
import type { SessionEntry } from "../types.js";

type PermissionToolCallHandler = {
	getEntries(sessionId: string): SessionEntry[];
	updateToolCallEntry(sessionId: string, update: ToolCallUpdate): void;
};

function hasToolCallEntry(
	handler: PermissionToolCallHandler,
	sessionId: string,
	toolCallId: string
): boolean {
	return handler
		.getEntries(sessionId)
		.some((entry) => entry.type === "tool_call" && entry.message.id === toolCallId);
}

export function enrichExistingToolCallFromPermission(
	handler: PermissionToolCallHandler,
	permission: PermissionRequest
): void {
	const toolCallId = permission.tool?.callID;
	const parsedArguments = permission.metadata.parsedArguments;

	if (toolCallId === undefined || parsedArguments == null) {
		return;
	}

	if (!hasToolCallEntry(handler, permission.sessionId, toolCallId)) {
		return;
	}

	handler.updateToolCallEntry(permission.sessionId, {
		toolCallId,
		arguments: parsedArguments,
	});
}

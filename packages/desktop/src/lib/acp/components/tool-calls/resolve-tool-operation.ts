import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";

export interface ResolvedToolOperation {
	resolvedKind: ToolKind;
	routeKey: ToolKind;
	toolCall: ToolCall;
	shouldShowInlinePermissionActionBar: boolean;
}

export function resolveToolOperation(
	toolCall: ToolCall,
	pendingPermission: PermissionRequest | null | undefined
): ResolvedToolOperation {
	const resolvedKind = toolCall.kind ?? "other";

	return {
		resolvedKind,
		routeKey: resolvedKind,
		toolCall,
		shouldShowInlinePermissionActionBar:
			pendingPermission !== null &&
			pendingPermission !== undefined &&
			resolvedKind !== "exit_plan_mode",
	};
}

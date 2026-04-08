import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";

export type ToolRouteKey = ToolKind | "read_lints";

export interface ResolvedToolOperation {
	resolvedKind: ToolKind;
	routeKey: ToolRouteKey;
	toolCall: ToolCall;
	shouldShowInlinePermissionActionBar: boolean;
}

export function resolveToolOperation(
	toolCall: ToolCall,
	pendingPermission: PermissionRequest | null | undefined
): ResolvedToolOperation {
	const resolvedKind = toolCall.kind ?? "other";
	const routeKey = resolveToolRouteKey(toolCall, resolvedKind);

	return {
		resolvedKind,
		routeKey,
		toolCall,
		shouldShowInlinePermissionActionBar:
			pendingPermission !== null &&
			pendingPermission !== undefined &&
			resolvedKind !== "exit_plan_mode",
	};
}

export function resolveToolRouteKey(toolCall: ToolCall, resolvedKind: ToolKind): ToolRouteKey {
	if (
		resolvedKind === "read" &&
		(toolCall.title?.trim() === "Read Lints" || toolCall.name === "read_lints")
	) {
		return "read_lints";
	}

	return resolvedKind;
}

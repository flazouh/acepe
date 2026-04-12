import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { buildToolPresentation, type ToolRouteKey, resolveToolRouteKey } from "./tool-presentation.js";

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
	const presentation = buildToolPresentation({ toolCall, pendingPermission });

	return {
		resolvedKind: presentation.resolvedKind,
		routeKey: presentation.routeKey,
		toolCall,
		shouldShowInlinePermissionActionBar: presentation.shouldShowInlinePermissionActionBar,
	};
}
export { resolveToolRouteKey };

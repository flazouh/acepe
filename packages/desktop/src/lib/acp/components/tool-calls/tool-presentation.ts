import type { AgentToolKind, AgentToolStatus } from "@acepe/ui/agent-panel";

import {
	formatOtherToolName,
	getToolKindFilePath,
	getToolKindSubtitle,
	getToolKindTitle,
} from "../../registry/tool-kind-ui-registry.js";
import type { TurnState } from "../../store/types.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { toAgentToolKind } from "./tool-kind-to-agent-tool-kind.js";

export type ToolRouteKey = ToolKind | "read_lints";

export interface BuildToolPresentationOptions {
	toolCall: ToolCall;
	toolKind?: ToolKind | null;
	turnState?: TurnState;
	parentCompleted?: boolean;
	pendingPermission?: PermissionRequest | null;
	isActiveToolCall?: boolean;
}

export interface ToolPresentation {
	resolvedKind: ToolKind;
	routeKey: ToolRouteKey;
	sceneKind:
		| "read"
		| "edit"
		| "delete"
		| "execute"
		| "search"
		| "fetch"
		| "web_search"
		| "think"
		| "skill"
		| "task"
		| "task_output"
		| "browser"
		| "other";
	agentKind: AgentToolKind;
	title: string;
	subtitle?: string;
	filePath?: string;
	agentStatus: AgentToolStatus;
	sceneStatus: "pending" | "running" | "done" | "error";
	compactTitle: string;
	shouldShowInlinePermissionActionBar: boolean;
	useDesktopRenderer: boolean;
}

export function resolveToolRouteKey(toolCall: ToolCall, resolvedKind: ToolKind): ToolRouteKey {
	if (toolCall.title?.trim() === "Read Lints" || toolCall.name === "read_lints") {
		return "read_lints";
	}

	return resolvedKind;
}

export function shouldUseDesktopToolRendererForRoute(routeKey: ToolRouteKey): boolean {
	return routeKey === "edit" || routeKey === "read" || routeKey === "question" || routeKey === "skill";
}

export function buildToolPresentation(options: BuildToolPresentationOptions): ToolPresentation {
	const resolvedKind = options.toolKind ?? options.toolCall.kind ?? "other";
	const routeKey = resolveToolRouteKey(options.toolCall, resolvedKind);
	const title = resolveToolPresentationTitle(options.toolCall, resolvedKind, options.turnState);
	const subtitle = getToolKindSubtitle(resolvedKind, options.toolCall) || undefined;
	const filePath = getToolKindFilePath(resolvedKind, options.toolCall) ?? undefined;
	const agentStatus = mapAgentToolStatus(
		options.toolCall,
		options.turnState,
		options.parentCompleted === true
	);
	const sceneStatus = mapSceneToolStatus(
		options.toolCall,
		options.turnState,
		options.parentCompleted === true,
		options.isActiveToolCall === true
	);

	return {
		resolvedKind,
		routeKey,
		sceneKind: mapSceneToolKind(routeKey, resolvedKind),
		agentKind: toAgentToolKind(resolvedKind) ?? "other",
		title,
		subtitle,
		filePath,
		agentStatus,
		sceneStatus,
		compactTitle: filePath ? title : (subtitle ?? title),
		shouldShowInlinePermissionActionBar:
			options.pendingPermission !== null &&
			options.pendingPermission !== undefined &&
			routeKey !== "exit_plan_mode",
		useDesktopRenderer: shouldUseDesktopToolRendererForRoute(routeKey),
	};
}

function resolveToolPresentationTitle(
	toolCall: ToolCall,
	kind: ToolKind,
	turnState: TurnState | undefined
): string {
	const semanticTitle =
		kind === "other"
			? formatOtherToolName(toolCall.name)
			: (getToolKindTitle(kind, toolCall, turnState) ?? toolCall.name);
	const rawTitle = toolCall.title?.trim();

	if (!rawTitle) {
		return semanticTitle;
	}

	if (
		(kind === "delete" &&
			rawTitle.localeCompare("apply_patch", undefined, { sensitivity: "accent" }) === 0) ||
		kind === "skill"
	) {
		return semanticTitle;
	}

	return rawTitle;
}

function mapAgentToolStatus(
	toolCall: ToolCall,
	turnState: TurnState | undefined,
	parentCompleted: boolean
): AgentToolStatus {
	if (toolCall.status === "failed") {
		return "error";
	}

	if (toolCall.status === "completed") {
		return "done";
	}

	const hasResult = toolCall.result !== null && toolCall.result !== undefined;
	if (hasResult || parentCompleted) {
		return "done";
	}

	if (toolCall.status === "in_progress" && turnState === "streaming") {
		return "running";
	}

	if (toolCall.status === "in_progress" && turnState !== undefined && turnState !== "streaming") {
		return "done";
	}

	return "pending";
}

function mapSceneToolStatus(
	toolCall: ToolCall,
	turnState: TurnState | undefined,
	parentCompleted: boolean,
	isActiveToolCall: boolean
): "pending" | "running" | "done" | "error" {
	if (toolCall.status === "failed") {
		return "error";
	}

	if (toolCall.status === "completed") {
		return "done";
	}

	const hasResult = toolCall.result !== null && toolCall.result !== undefined;
	if (hasResult || parentCompleted) {
		return "done";
	}

	if (!isActiveToolCall || turnState !== "streaming") {
		return "done";
	}

	if (toolCall.status === "in_progress") {
		return "running";
	}

	return "pending";
}

function mapSceneToolKind(
	routeKey: ToolRouteKey,
	resolvedKind: ToolKind
): ToolPresentation["sceneKind"] {
	if (routeKey === "read_lints") {
		return "read";
	}

	if (resolvedKind === "glob") {
		return "search";
	}

	if (
		resolvedKind === "read" ||
		resolvedKind === "edit" ||
		resolvedKind === "delete" ||
		resolvedKind === "execute" ||
		resolvedKind === "search" ||
		resolvedKind === "fetch" ||
		resolvedKind === "web_search" ||
		resolvedKind === "think" ||
		resolvedKind === "skill" ||
		resolvedKind === "task" ||
		resolvedKind === "task_output" ||
		resolvedKind === "browser"
	) {
		return resolvedKind;
	}

	return "other";
}

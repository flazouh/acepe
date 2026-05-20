import type { ToolArguments } from "../../../services/converted-session-types.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import { makeWorkspaceRelative } from "../../utils/path-utils.js";

type PermissionMetadataShape = {
	parsedArguments?: ToolArguments | null;
};

function getMetadata(permission: PermissionRequest): PermissionMetadataShape | null {
	return (permission.metadata as PermissionMetadataShape) ?? null;
}

function normalizePath(value: string | null | undefined): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function extractPathFromPermissionLabel(label: string): string | null {
	const match = /^(read|edit|write|delete)\s+(.+)$/i.exec(label.trim());
	if (!match) return null;
	const rawCandidate = match[2]?.trim();
	if (!rawCandidate) return null;

	const unwrapped = rawCandidate.replace(/^["'`](.+)["'`]$/, "$1");
	const normalized = normalizePath(unwrapped);
	if (!normalized) return null;

	const looksLikePath =
		normalized.includes("/") ||
		normalized.includes("\\") ||
		normalized.startsWith("~") ||
		/^[a-zA-Z]:\\/.test(normalized) ||
		normalized.includes(".");

	return looksLikePath ? normalized : null;
}

const TOOL_KIND_LABELS: Record<string, string> = {
	read: "Read",
	edit: "Edit",
	execute: "Execute",
	search: "Search",
	glob: "Glob",
	fetch: "Fetch",
	webSearch: "Web Search",
	think: "Think",
	taskOutput: "Task Output",
	move: "Move",
	delete: "Delete",
	planMode: "Plan",
	toolSearch: "Tool Search",
};

function isPathAccessPermission(permission: PermissionRequest): boolean {
	return permission.permission
		.trim()
		.toLowerCase()
		.includes("access paths outside trusted directories");
}

export type PermissionDisplayKind =
	| "read"
	| "edit"
	| "execute"
	| "search"
	| "fetch"
	| "web_search"
	| "delete"
	| "move"
	| "other";

export interface CompactPermissionDisplay {
	readonly kind: PermissionDisplayKind;
	readonly label: string;
	readonly command: string | null;
	readonly filePath: string | null;
}

export interface PermissionBarSummaryVisibilityInput {
	readonly isRepresentedByToolCall: boolean;
	readonly display: CompactPermissionDisplay;
	readonly toolCall?: ToolCall | null;
}

function normalizePermissionDisplayKind(value: string | null | undefined): PermissionDisplayKind {
	if (!value) {
		return "other";
	}

	const normalized = value.trim().toLowerCase();

	switch (normalized) {
		case "read":
			return "read";
		case "edit":
		case "write":
			return "edit";
		case "execute":
		case "bash":
			return "execute";
		case "search":
		case "glob":
			return "search";
		case "fetch":
			return "fetch";
		case "websearch":
		case "web_search":
			return "web_search";
		case "delete":
			return "delete";
		case "move":
			return "move";
		default:
			return "other";
	}
}

export function extractPermissionToolKind(permission: PermissionRequest): PermissionDisplayKind {
	if (isPathAccessPermission(permission)) {
		return "other";
	}

	const metadata = getMetadata(permission);
	const parsed = metadata?.parsedArguments;
	if (parsed && parsed.kind !== "other") {
		return normalizePermissionDisplayKind(parsed.kind);
	}

	// Fallback: use the permission label, but take just the first word
	// to avoid showing full strings like "Write /tmp/file.ts"
	const firstWord = permission.permission.split(" ")[0];
	return normalizePermissionDisplayKind(firstWord ? firstWord : permission.permission);
}

export function extractPermissionCommand(permission: PermissionRequest): string | null {
	const metadata = getMetadata(permission);

	const parsed = metadata?.parsedArguments;
	if (parsed?.kind === "execute" && parsed.command) {
		return parsed.command;
	}

	return null;
}

export function extractPermissionFilePath(permission: PermissionRequest): string | null {
	const metadata = getMetadata(permission);

	const parsed = metadata?.parsedArguments;
	if (parsed) {
		switch (parsed.kind) {
			case "read":
			case "search":
			case "delete":
				{
					const parsedPath = normalizePath(parsed.file_path ?? null);
					if (parsedPath) return parsedPath;
				}
				break;
			case "edit":
				{
					const parsedPath = normalizePath(parsed.edits[0]?.filePath ?? null);
					if (parsedPath) return parsedPath;
				}
				break;
		}
	}

	return extractPathFromPermissionLabel(permission.permission);
}

function extractToolCallCommand(toolCall: ToolCall | null | undefined): string | null {
	const args = toolCall?.arguments;
	if (args?.kind === "execute") {
		return normalizePath(args.command ?? null);
	}

	return null;
}

function extractToolCallFilePath(toolCall: ToolCall | null | undefined): string | null {
	const args = toolCall?.arguments;
	if (!args) {
		return null;
	}

	switch (args.kind) {
		case "read":
		case "search":
		case "delete":
			return normalizePath(args.file_path ?? null);
		case "edit":
			return normalizePath(args.edits[0]?.filePath ?? null);
		case "move":
			return normalizePath(args.to ?? args.from ?? null);
		case "glob":
			return normalizePath(args.path ?? null);
		default:
			return null;
	}
}

export function extractCompactPermissionDisplay(
	permission: PermissionRequest,
	projectPath?: string | null,
	toolCall?: ToolCall | null
): CompactPermissionDisplay {
	const toolCallKind = normalizePermissionDisplayKind(toolCall?.kind ?? null);
	const kind = toolCallKind === "other" ? extractPermissionToolKind(permission) : toolCallKind;
	const rawFilePath = extractToolCallFilePath(toolCall) ?? extractPermissionFilePath(permission);
	const filePath = rawFilePath
		? makeWorkspaceRelative(rawFilePath, projectPath ? projectPath : "")
		: null;
	const rawCommand = extractToolCallCommand(toolCall) ?? extractPermissionCommand(permission);
	const command = kind === "execute" ? rawCommand : null;

	return {
		kind,
		label: isPathAccessPermission(permission) && toolCallKind === "other"
			? "Access"
			: (TOOL_KIND_LABELS[kind] ?? "Permission"),
		command,
		filePath,
	};
}

export function shouldShowPermissionBarSummary(
	input: PermissionBarSummaryVisibilityInput
): boolean {
	if (!input.isRepresentedByToolCall) {
		return true;
	}

	const toolCall = input.toolCall;
	if (!toolCall) {
		return true;
	}

	const toolCallFilePath = extractToolCallFilePath(toolCall);
	if (input.display.filePath && !toolCallFilePath) {
		return true;
	}

	const toolCallCommand = extractToolCallCommand(toolCall);
	if (input.display.command && !toolCallCommand) {
		return true;
	}

	return !toolCallFilePath && !toolCallCommand;
}

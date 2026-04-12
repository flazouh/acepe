import type { ToolArguments } from "../../../services/converted-session-types.js";
import type { PermissionRequest } from "../../types/permission.js";
import { makeWorkspaceRelative } from "../../utils/path-utils.js";

type PermissionRawInput = {
	command?: string | null;
	filePath?: string | null;
	file_path?: string | null;
	path?: string | null;
};

type PermissionMetadataShape = {
	parsedArguments?: ToolArguments | null;
	rawInput?: PermissionRawInput | null;
};

function getMetadata(permission: PermissionRequest): PermissionMetadataShape | null {
	return (permission.metadata as PermissionMetadataShape) ?? null;
}

function normalizePath(value: string | null | undefined): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readLegacyFilePath(value: object | null | undefined): string | null {
	if (!value) return null;
	if (!("filePath" in value)) return null;
	const candidate = value.filePath;
	return typeof candidate === "string" ? normalizePath(candidate) : null;
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

	// Prefer Rust-parsed arguments (agent-agnostic)
	const parsed = metadata?.parsedArguments;
	if (parsed?.kind === "execute" && parsed.command) {
		return parsed.command;
	}

	// Legacy fallback
	return metadata?.rawInput?.command ?? null;
}

export function extractPermissionFilePath(permission: PermissionRequest): string | null {
	const metadata = getMetadata(permission);

	// Prefer Rust-parsed arguments (agent-agnostic)
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
					const firstEdit = parsed.edits[0];
					const parsedPath = normalizePath(
						firstEdit?.file_path ?? readLegacyFilePath(firstEdit ?? null)
					);
					if (parsedPath) return parsedPath;
				}
				break;
		}
	}

	// Legacy fallback
	const rawInput = metadata?.rawInput;
	const rawInputPath = normalizePath(
		rawInput?.file_path ?? rawInput?.filePath ?? rawInput?.path ?? null
	);
	if (rawInputPath) return rawInputPath;

	return extractPathFromPermissionLabel(permission.permission);
}

export function extractCompactPermissionDisplay(
	permission: PermissionRequest,
	projectPath?: string | null
): CompactPermissionDisplay {
	const kind = extractPermissionToolKind(permission);
	const rawFilePath = extractPermissionFilePath(permission);
	const filePath = rawFilePath
		? makeWorkspaceRelative(rawFilePath, projectPath ? projectPath : "")
		: null;
	const rawCommand = extractPermissionCommand(permission);
	const command = kind === "execute" ? rawCommand : null;

	return {
		kind,
		label: TOOL_KIND_LABELS[kind] ?? "Permission",
		command,
		filePath,
	};
}

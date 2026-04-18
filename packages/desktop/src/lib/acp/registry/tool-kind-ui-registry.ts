import type { TurnState } from "../store/types.js";
import { isSearchNormalizedResult } from "../types/normalized-tool-result.js";
import type { ToolCall } from "../types/tool-call.js";
import type { ToolKind } from "../types/tool-kind.js";
import { extractSkillCallInput } from "../utils/extract-skill-call-input.js";
import {
	getDisplayPath,
	getToolStatus,
	truncateText,
} from "../utils/tool-state-utils.js";

/**
 * Tool UI metadata for a specific tool kind.
 *
 * This provides all the information needed to render a tool's UI based on its canonical kind.
 */
export interface ToolKindUI {
	/** Dynamic title based on tool state */
	title: (toolCall: ToolCall, turnState?: TurnState) => string;
	/** Optional subtitle for additional context */
	subtitle?: (toolCall: ToolCall) => string;
	/** Optional tooltip content */
	tooltipContent?: (toolCall: ToolCall) => string;
	/** Optional file path getter for file-based tools (enables file icon display) */
	filePath?: (toolCall: ToolCall) => string | null | undefined;
}

/**
 * Extract filename from a path
 */
function getFileName(filePath: string | null | undefined): string {
	if (!filePath) return "";
	return filePath.split("/").pop() || "";
}

function getDeleteFilePaths(toolCall: ToolCall): string[] {
	if (toolCall.arguments.kind !== "delete") {
		return [];
	}

	const filePaths = toolCall.arguments.file_paths;
	if (filePaths && filePaths.length > 0) {
		return filePaths;
	}

	const filePath = toolCall.arguments.file_path;
	return filePath ? [filePath] : [];
}

function getDeleteSubtitle(toolCall: ToolCall): string {
	const filePaths = getDeleteFilePaths(toolCall);
	if (filePaths.length === 0) {
		return "";
	}

	if (filePaths.length === 1) {
		return truncateText(filePaths[0], 50);
	}

	return `${getFileName(filePaths[0])} +${filePaths.length - 1}`;
}

function getReadSourcePath(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind !== "read") {
		return null;
	}

	return toolCall.arguments.file_path ?? toolCall.arguments.source_context?.path ?? null;
}

/**
 * Format raw tool names into readable titles for "other" tool kind.
 */
export function formatOtherToolName(name: string): string {
	// MCP-style names are often "mcp__server__ToolName" - display only final segment.
	const mcpSegments = name.split("__").filter((segment) => segment.length > 0);
	const baseName = mcpSegments.length > 0 ? mcpSegments[mcpSegments.length - 1] : name;

	// Split PascalCase boundaries, then normalize snake_case / kebab-case separators.
	const withWordBoundaries = baseName.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
	const normalizedSeparators = withWordBoundaries.replace(/[_-]+/g, " ");

	return normalizedSeparators
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/**
 * Extract the function segment from an MCP-style browser tool name.
 * "mcp__tauri__webview_screenshot" → "webview_screenshot"
 * "tauri-webview_screenshot" → "webview_screenshot"
 */
function extractBrowserFuncName(name: string): string {
	const segments = name.split("__").filter((s) => s.length > 0);
	const last = segments[segments.length - 1] ?? name;
	const dashIdx = last.indexOf("-");
	return dashIdx >= 0 ? last.slice(dashIdx + 1) : last;
}

const BROWSER_TITLE_MAP: Record<string, string> = {
	webview_screenshot: "Screenshot",
	webview_find_element: "Find Element",
	webview_interact: "Interact",
	webview_keyboard: "Keyboard",
	webview_wait_for: "Wait For",
	webview_get_styles: "Get Styles",
	webview_execute_js: "Execute JS",
	webview_dom_snapshot: "DOM Snapshot",
	webview_select_element: "Select Element",
	webview_get_pointed_element: "Get Pointed Element",
	ipc_execute_command: "IPC Command",
	ipc_monitor: "IPC Monitor",
	ipc_get_captured: "IPC Captured",
	ipc_emit_event: "IPC Emit",
	ipc_get_backend_state: "Backend State",
	driver_session: "Driver Session",
	manage_window: "Manage Window",
	read_logs: "Read Logs",
	list_devices: "List Devices",
};

function formatBrowserTitle(funcName: string): string {
	return BROWSER_TITLE_MAP[funcName] ?? formatOtherToolName(funcName);
}

/**
 * Tool Kind UI Registry
 *
 * Maps canonical ToolKind to UI metadata for rendering.
 * This is the single source of truth for tool UI behavior.
 *
 * TypeScript receives canonical ToolKind from Rust adapters - it never sees agent-specific tool names.
 * All agent-specific name normalization happens in Rust.
 */
export const TOOL_KIND_UI_REGISTRY: Record<ToolKind, ToolKindUI> = {
	read: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Reading" : "Read";
		},
		subtitle: (toolCall) => {
			const filePath = getReadSourcePath(toolCall);
			return filePath ? truncateText(filePath, 50) : (toolCall.title ?? "");
		},
		filePath: (toolCall) => getReadSourcePath(toolCall),
		tooltipContent: (toolCall) => {
			const filePath = getReadSourcePath(toolCall);
			return filePath ? getDisplayPath(filePath) : "";
		},
	},

	edit: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Editing" : "Edited";
		},
		filePath: (toolCall) =>
			toolCall.arguments.kind === "edit" ? (toolCall.arguments.edits[0]?.filePath ?? null) : null,
		tooltipContent: (toolCall) => {
			const filePath =
				toolCall.arguments.kind === "edit" ? (toolCall.arguments.edits[0]?.filePath ?? null) : null;
			return filePath ? getDisplayPath(filePath) : "";
		},
	},

	execute: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Running command" : "Executed";
		},
		subtitle: (toolCall) => {
			const command = toolCall.arguments.kind === "execute" ? toolCall.arguments.command : null;
			if (command) {
				// Normalize and truncate
				const normalized = command.replace(/\\\s*\n\s*/g, " ").trim();
				return truncateText(normalized, 50);
			}
			// Fallback to title (from task children summary)
			return toolCall.title ?? "";
		},
	},

	search: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			if (status.isPending) return "Grepping";

			const normalizedResult = isSearchNormalizedResult(toolCall.normalizedResult)
				? toolCall.normalizedResult
				: null;
			const hasAnyResult =
				(toolCall.result !== null && toolCall.result !== undefined) ||
				(toolCall.normalizedResult !== null && toolCall.normalizedResult !== undefined);
			if (!hasAnyResult) {
				return "Grep";
			}

			if (normalizedResult === null) {
				return "Grep";
			}

			const numFiles = normalizedResult.numFiles;
			return numFiles > 0 ? `Grepped ${numFiles} files` : "No matches";
		},
		subtitle: (toolCall) => {
			const query = toolCall.arguments.kind === "search" ? toolCall.arguments.query : null;
			// Fallback to title (from task children summary)
			return query ? truncateText(query, 40) : (toolCall.title ?? "");
		},
	},

	glob: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			if (status.isPending) return "Exploring files";

			const result = toolCall.result as Record<string, unknown> | unknown[] | null;
			if (!result) {
				return "Exploring files";
			}
			const totalFiles =
				(typeof result === "object" && "totalFiles" in result
					? (result.totalFiles as number)
					: null) ?? (Array.isArray(result) ? result.length : 0);
			return totalFiles > 0 ? `Found ${totalFiles} files` : "No files found";
		},
		subtitle: (toolCall) => {
			const pattern = toolCall.arguments.kind === "glob" ? toolCall.arguments.pattern : null;
			return pattern ? truncateText(pattern, 40) : (toolCall.title ?? "");
		},
	},

	fetch: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Fetching" : "Fetched";
		},
		subtitle: (toolCall) => {
			const url = toolCall.arguments.kind === "fetch" ? toolCall.arguments.url : null;
			if (!url) return "";
			// Extract domain from URL
			const urlObj = URL.parse(url);
			return urlObj?.hostname?.replace(/^www\./, "") ?? truncateText(url, 30);
		},
	},

	web_search: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			const query = toolCall.arguments.kind === "webSearch" ? toolCall.arguments.query : null;
			const displayQuery = query ? truncateText(query, 30) : "...";

			if (status.isPending) {
				return `Searching for "${displayQuery}"...`;
			}

			return `Searched for "${displayQuery}"`;
		},
		subtitle: (toolCall) => {
			const query = toolCall.arguments.kind === "webSearch" ? toolCall.arguments.query : null;
			return query ? truncateText(query, 40) : "";
		},
	},

	think: {
		title: () => "Thinking",
		subtitle: (toolCall) => {
			if (toolCall.arguments.kind === "think" && toolCall.arguments.description) {
				return truncateText(toolCall.arguments.description, 50);
			}
			return "";
		},
	},

	todo: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Updating todos" : "Updated todos";
		},
		subtitle: (toolCall) => {
			const todos = toolCall.normalizedTodos;
			if (!todos || todos.length === 0) return "";
			// Find the in-progress task
			const inProgress = todos.find((t) => t.status === "in_progress");
			if (inProgress) {
				return truncateText(inProgress.activeForm || inProgress.content, 50);
			}
			// Fallback to last item if no in-progress
			const lastTodo = todos[todos.length - 1];
			return truncateText(lastTodo.activeForm || lastTodo.content, 50);
		},
	},

	question: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Asking question" : "Asked question";
		},
		subtitle: (toolCall) => {
			// Show the first question text if available from normalizedQuestions
			const questions = toolCall.normalizedQuestions;
			if (questions && questions.length > 0) {
				return truncateText(questions[0].question, 50);
			}
			return "";
		},
	},

	task: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Running task" : "Task completed";
		},
		subtitle: (toolCall) => {
			if (toolCall.arguments.kind === "think" && toolCall.arguments.description) {
				return truncateText(toolCall.arguments.description, 50);
			}
			return "";
		},
	},

	skill: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			const skillName = extractSkillCallInput(toolCall.arguments).skill;
			const displayName = skillName ?? "skill";
			return status.isPending
				? `Running ${displayName}`
				: `Ran ${displayName}`;
		},
		subtitle: (toolCall) => {
			if (toolCall.skillMeta?.description) {
				return toolCall.skillMeta.description;
			}
			return "";
		},
	},

	move: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Moving" : "Moved";
		},
		subtitle: (toolCall) => {
			const from = toolCall.arguments.kind === "move" ? toolCall.arguments.from : null;
			const to = toolCall.arguments.kind === "move" ? toolCall.arguments.to : null;
			if (from && to) {
				const fromName = getFileName(from);
				const toName = getFileName(to);
				return `${fromName} → ${toName}`;
			}
			return "";
		},
	},

	delete: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Deleting" : "Deleted";
		},
		subtitle: (toolCall) => getDeleteSubtitle(toolCall),
		tooltipContent: (toolCall) =>
			getDeleteFilePaths(toolCall)
				.map((path) => getDisplayPath(path))
				.join("\n"),
		filePath: (toolCall) => {
			const filePaths = getDeleteFilePaths(toolCall);
			return filePaths.length === 1 ? filePaths[0] : null;
		},
	},

	enter_plan_mode: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending
				? "Entering plan mode"
				: "Entered plan mode";
		},
	},

	exit_plan_mode: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Reviewing plan" : "Plan ready";
		},
	},

	create_plan: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Creating plan" : "Created plan";
		},
	},

	tool_search: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Loading tools" : "Loaded tools";
		},
		subtitle: (toolCall) => {
			const query = toolCall.arguments.kind === "toolSearch" ? toolCall.arguments.query : null;
			return query ? truncateText(query, 40) : "";
		},
	},

	task_output: {
		title: (toolCall, turnState) => {
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Getting output" : "Got output";
		},
		subtitle: (toolCall) => {
			const taskId = toolCall.arguments.kind === "taskOutput" ? toolCall.arguments.task_id : null;
			return typeof taskId === "string" ? truncateText(taskId, 40) : "";
		},
	},

	browser: {
		title: (toolCall) => {
			const name = toolCall.name;
			const funcName = extractBrowserFuncName(name);
			return formatBrowserTitle(funcName);
		},
		subtitle: (toolCall) => {
			if (toolCall.arguments.kind !== "browser") return "";
			const raw = toolCall.arguments.raw;
			if (typeof raw !== "object" || raw === null) return "";
			const obj = raw as Record<string, unknown>;
			const action = typeof obj.action === "string" ? obj.action : null;
			const selector = typeof obj.selector === "string" ? obj.selector : null;
			const script = typeof obj.script === "string" ? obj.script : null;
			if (action && selector) return `${action} → ${truncateText(selector, 30)}`;
			if (action) return action;
			if (selector) return truncateText(selector, 40);
			if (script) return truncateText(script.replace(/\s+/g, " "), 40);
			return "";
		},
	},

	sql: {
		title: (toolCall, turnState) => {
			if (toolCall.title?.trim()) {
				return toolCall.title;
			}
			const status = getToolStatus(toolCall, turnState);
			return status.isPending ? "Running SQL" : "SQL";
		},
		subtitle: (toolCall) => {
			if (toolCall.arguments.kind !== "sql") return "";
			if (toolCall.arguments.description) {
				return truncateText(toolCall.arguments.description, 50);
			}
			if (toolCall.arguments.query) {
				return truncateText(toolCall.arguments.query.replace(/\s+/g, " "), 50);
			}
			return "";
		},
	},

	unclassified: {
		title: (toolCall) => {
			if (toolCall.title?.trim()) {
				return toolCall.title;
			}
			if (toolCall.arguments.kind !== "unclassified") {
				return "Unclassified Tool";
			}
			return formatOtherToolName(toolCall.arguments.raw_name || toolCall.name || "tool");
		},
		subtitle: (toolCall) => {
			if (toolCall.arguments.kind !== "unclassified") return "";
			if (toolCall.arguments.arguments_preview) {
				return truncateText(toolCall.arguments.arguments_preview, 50);
			}
			const formatted = formatOtherToolName(toolCall.arguments.raw_name || toolCall.name);
			const title = toolCall.title?.trim();
			return title && formatted === title ? "" : formatted;
		},
	},

	other: {
		title: (toolCall) => toolCall.title || formatOtherToolName(toolCall.name),
		subtitle: (toolCall) => {
			if (!toolCall.title) return "";
			const formatted = formatOtherToolName(toolCall.name);
			return formatted === toolCall.title ? "" : formatted;
		},
	},
};

/**
 * Get tool UI metadata by tool kind.
 *
 * @param kind - The canonical tool kind
 * @returns Tool UI metadata
 */
export function getToolKindUI(kind: ToolKind): ToolKindUI {
	return TOOL_KIND_UI_REGISTRY[kind];
}

/**
 * Get dynamic tool title based on kind and current state.
 *
 * @param kind - The canonical tool kind
 * @param toolCall - The tool call
 * @param turnState - Current turn state
 * @returns Dynamic title string
 */
export function getToolKindTitle(
	kind: ToolKind,
	toolCall: ToolCall,
	turnState?: TurnState
): string {
	const ui = getToolKindUI(kind);
	return ui.title(toolCall, turnState);
}

/**
 * Get tool subtitle if available.
 *
 * @param kind - The canonical tool kind
 * @param toolCall - The tool call
 * @returns Subtitle string or empty string
 */
export function getToolKindSubtitle(kind: ToolKind, toolCall: ToolCall): string {
	const ui = getToolKindUI(kind);
	return ui.subtitle?.(toolCall) ?? "";
}

/**
 * Get tool tooltip content if available.
 *
 * @param kind - The canonical tool kind
 * @param toolCall - The tool call
 * @returns Tooltip content or empty string
 */
export function getToolKindTooltip(kind: ToolKind, toolCall: ToolCall): string {
	const ui = getToolKindUI(kind);
	return ui.tooltipContent?.(toolCall) ?? "";
}

/**
 * Get file path from tool call if available.
 * Used for file-based tools to display file icon + filename.
 *
 * @param kind - The canonical tool kind
 * @param toolCall - The tool call
 * @returns File path or null
 */
export function getToolKindFilePath(kind: ToolKind, toolCall: ToolCall): string | null {
	const ui = getToolKindUI(kind);
	return ui.filePath?.(toolCall) ?? null;
}

/**
 * Get display text for compact UI (queue item, session list item).
 * Uses subtitle when available, else title. For file tools, returns basename only
 * (consumer adds a verb prefix such as "Reading X", "Editing X").
 *
 * @param kind - The canonical tool kind
 * @param toolCall - The tool call
 * @param turnState - Current turn state ("streaming" or "completed")
 * @returns Display string for compact UI
 */
export function getToolCompactDisplayText(
	kind: ToolKind,
	toolCall: ToolCall,
	turnState?: TurnState
): string {
	if (kind === "read" || kind === "edit" || kind === "delete") {
		const path = getToolKindFilePath(kind, toolCall);
		return path ? getFileName(path) : "";
	}
	const subtitle = getToolKindSubtitle(kind, toolCall);
	if (subtitle) return subtitle;
	return getToolKindTitle(kind, toolCall, turnState);
}

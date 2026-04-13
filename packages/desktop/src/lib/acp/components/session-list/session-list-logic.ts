import type { SessionEntry, SessionSummary } from "../../application/dto/session.js";
import type { Project } from "../../logic/project-manager.svelte.js";
import type { Checkpoint } from "../../types/checkpoint.js";
import { extractProjectName } from "../../utils/path-utils.js";

import { createProjectColorMap, createProjectNameMap } from "../../utils/project-utils.js";
import type {
	LastToolInfo,
	SessionActivityInfo,
	SessionGroup,
	SessionListItem,
	TodoProgressInfo,
} from "./session-list-types.js";

export { createProjectColorMap, createProjectNameMap };

import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { computeStatsFromCheckpoints } from "../../utils/checkpoint-diff-utils.js";
import { truncateText } from "../../utils/tool-state-utils.js";

/**
 * Pure logic functions for session list computations.
 * All functions are pure - no side effects, no runes.
 */

/**
 * Builds session groups from project list with empty sessions (for loading state).
 * Used when session data is still loading but project data from DB is available.
 */
export function createLoadingSessionGroups(projects: readonly Project[]): SessionGroup[] {
	return projects
		.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
		.map((project) => ({
			projectPath: project.path,
			projectName: project.name,
			projectColor: project.color,
			sessions: [],
		}));
}

/**
 * Extracts tool info from a single session entry.
 */
function extractToolTarget(toolCall: ToolCall, kind: ToolKind): string {
	const args = toolCall.arguments;
	switch (kind) {
		case "read":
		case "delete":
			if (args.kind === "read" || args.kind === "delete") {
				const path = args.file_path;
				return path ? path.split("/").pop() || path : "";
			}
			return "";
		case "edit":
			if (args.kind === "edit") {
				const path = args.edits[0]?.filePath;
				return path ? path.split("/").pop() || path : "";
			}
			return "";
		case "execute":
			if (args.kind === "execute" && args.command) {
				return truncateText(args.command.replace(/\\\s*\n\s*/g, " ").trim(), 50);
			}
			return "";
		case "search":
			return args.kind === "search" && args.query ? truncateText(args.query, 40) : "";
		case "glob":
			return args.kind === "glob" && args.pattern ? truncateText(args.pattern, 40) : "";
		case "think":
		case "task":
			if (args.kind === "think" && args.description) {
				return truncateText(args.description, 50);
			}
			return toolCall.title ?? "";
		default:
			return toolCall.title ?? "";
	}
}

function extractToolInfoFromEntry(entry: SessionEntry): LastToolInfo | null {
	if (entry.type !== "tool_call") return null;

	const toolCall = entry.message;
	const kind = (toolCall.kind || "other") as ToolKind;
	const name = toolCall.title || toolCall.name;
	const target = extractToolTarget(toolCall, kind);

	return { name, target: target || "", kind };
}

/**
 * Extracts current (streaming) tool info by scanning entries in reverse.
 * Finds the most recent tool_call entry with isStreaming = true.
 */
export function extractCurrentToolInfo(entries: readonly SessionEntry[]): LastToolInfo | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "tool_call" || !entry.isStreaming) continue;

		const info = extractToolInfoFromEntry(entry);
		if (info) return info;
	}
	return null;
}

/**
 * Extracts last tool info by scanning entries in reverse.
 * Finds the most recent tool_call entry (streaming or completed).
 */
export function extractLastToolInfo(entries: readonly SessionEntry[]): LastToolInfo | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "tool_call") continue;

		const info = extractToolInfoFromEntry(entry);
		if (info) return info;
	}
	return null;
}

/**
 * Extracts todo progress from session entries.
 * Scans entries in reverse to find the most recent TodoWrite with normalizedTodos.
 */
export function extractTodoProgress(entries: readonly SessionEntry[]): TodoProgressInfo | null {
	// Find the most recent TodoWrite tool call with normalized todos
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "tool_call") continue;

		const toolCall = entry.message;
		const todos = toolCall.normalizedTodos;
		if (!todos || todos.length === 0) continue;

		// Find current in-progress task
		const inProgressIndex = todos.findIndex((t) => t.status === "in_progress");
		const completedCount = todos.filter((t) => t.status === "completed").length;

		// Determine current step and label
		let current: number;
		let label: string;

		if (inProgressIndex >= 0) {
			const inProgressTodo = todos[inProgressIndex];
			current = inProgressIndex + 1;
			label = inProgressTodo.activeForm || inProgressTodo.content;
		} else if (completedCount === todos.length) {
			// All tasks completed - show "X/X Done"
			current = completedCount;
			label = "Done";
		} else {
			// Some completed, some pending, none in-progress - show waiting state
			current = completedCount;
			label = "Waiting";
		}

		return {
			current,
			total: todos.length,
			label: truncateText(label, 25),
		};
	}

	return null;
}

/**
 * Extracts activity info for a streaming session.
 */
export function extractActivityInfo(
	session: SessionSummary,
	entries: readonly SessionEntry[]
): SessionActivityInfo | null {
	// Only show activity for streaming sessions
	if (!session.isStreaming) return null;

	const todoProgress = extractTodoProgress(entries);
	const currentTool = extractCurrentToolInfo(entries);
	const lastTool = extractLastToolInfo(entries);

	return {
		isStreaming: true,
		todoProgress,
		currentTool,
		lastTool,
	};
}

/**
 * Session with optional entries for activity extraction.
 * Extends SessionSummary with entries for streaming sessions.
 */
export interface SessionWithEntries extends SessionSummary {
	readonly entries?: readonly SessionEntry[];
	readonly sourcePath?: string;
}

/**
 * Converts session summaries to display items.
 *
 * Performance: Does NOT read entries for all sessions. Entry reads in a $derived
 * chain create SvelteMap dependencies that fire on every rAF during streaming,
 * causing all SessionItem components to re-render. Instead, uses checkpoint-based
 * diff stats and derives streaming status from the session's isStreaming flag.
 */
export function createDisplayItems(
	sessions: readonly SessionWithEntries[],
	projectNameMap: Map<string, string>,
	projectColorMap: Map<string, string>,
	openSessionIds: Set<string>,
	getCheckpoints?: (sessionId: string) => readonly Checkpoint[]
): SessionListItem[] {
	return sessions.map((session): SessionListItem => {
		const projectName =
			projectNameMap.get(session.projectPath) || extractProjectName(session.projectPath);
		const projectColor = projectColorMap.get(session.projectPath);

		// Streaming indicator from session flag (no entry scan needed)
		const activity: SessionActivityInfo | null = session.isStreaming
			? { isStreaming: true, todoProgress: null, currentTool: null, lastTool: null }
			: null;

		// Diff stats from checkpoints only (no entry-based fallback to avoid SvelteMap reads)
		const diffStats = getCheckpoints
			? computeStatsFromCheckpoints(getCheckpoints(session.id))
			: null;
		const isOpen = openSessionIds.has(session.id);
		const isLive = isOpen || activity !== null;

		return {
			id: session.id,
			title: session.title || projectName,
			projectPath: session.projectPath,
			projectName,
			projectColor,
			agentId: session.agentId,
			sourcePath: session.sourcePath,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			isLive,
			isOpen,
			activity,
			parentId: session.parentId,
			insertions: diffStats?.insertions ?? 0,
			deletions: diffStats?.deletions ?? 0,
			entryCount: session.entryCount ?? 0,
			worktreePath: session.worktreePath,
			worktreeDeleted: session.worktreeDeleted,
			prNumber: session.prNumber,
			prState: session.prState,
			sequenceId: session.sequenceId,
		};
	});
}

/**
 * Filters items by search query.
 */
export function filterItems(
	items: readonly SessionListItem[],
	searchQuery: string
): SessionListItem[] {
	const query = searchQuery.toLowerCase().trim();
	if (!query) return Array.from(items);

	return items.filter(
		(item) =>
			item.title.toLowerCase().includes(query) || item.projectName.toLowerCase().includes(query)
	);
}

/**
 * Returns true if a session is "live" — currently open in a panel or actively streaming.
 * Live sessions are always shown; historical sessions require the user to opt in.
 */
export function isLiveSession(item: SessionListItem): boolean {
	return item.isLive;
}

/**
 * Filters a session group's sessions to only live sessions.
 * A session is live if it has an open panel or is actively streaming.
 */
export function filterLiveSessions(sessions: readonly SessionListItem[]): SessionListItem[] {
	return sessions.filter(isLiveSession);
}

/**
 * Limits items to N sessions per project, always including open sessions.
 */
export function limitItemsPerProject(
	items: readonly SessionListItem[],
	sessionsPerProject = 100
): SessionListItem[] {
	// Group by project first to ensure all projects are visible
	const byProject = new Map<string, SessionListItem[]>();
	for (const item of items) {
		const list = byProject.get(item.projectPath);
		if (list) {
			list.push(item);
		} else {
			byProject.set(item.projectPath, [item]);
		}
	}

	// Take N sessions per project (open sessions always included)
	const result: SessionListItem[] = [];
	for (const sessions of byProject.values()) {
		// Sort by date descending within project
		const sorted = sessions.toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
		const open = sorted.filter((s) => s.isOpen);
		const closed = sorted.filter((s) => !s.isOpen).slice(0, sessionsPerProject);
		result.push(...open, ...closed);
	}

	// Final sort by date for display order
	return result.toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export const SESSION_LIST_PAGE_SIZE = 10;

export function getSessionListVisibleCount(
	totalSessions: number,
	currentVisible: number | null | undefined,
	pageSize = SESSION_LIST_PAGE_SIZE
): number {
	if (totalSessions <= 0) {
		return 0;
	}

	const minimumVisible = Math.min(totalSessions, pageSize);
	if (currentVisible === null || currentVisible === undefined) {
		return minimumVisible;
	}

	if (currentVisible < minimumVisible) {
		return minimumVisible;
	}

	if (currentVisible > totalSessions) {
		return totalSessions;
	}

	return currentVisible;
}

export function getNextSessionListVisibleCount(
	totalSessions: number,
	currentVisible: number | null | undefined,
	pageSize = SESSION_LIST_PAGE_SIZE
): number {
	const normalizedVisible = getSessionListVisibleCount(totalSessions, currentVisible, pageSize);
	if (normalizedVisible >= totalSessions) {
		return totalSessions;
	}

	return Math.min(totalSessions, normalizedVisible + pageSize);
}

export function isSessionListNearBottom(
	scrollTop: number,
	clientHeight: number,
	scrollHeight: number,
	threshold = 24
): boolean {
	return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

/**
 * Row representation for hierarchical session display.
 */
export interface SessionRow {
	item: SessionListItem;
	depth: number;
	hasChildren: boolean;
	isExpanded: boolean;
}

/**
 * Builds a flat list of session rows with hierarchy information.
 * Groups sessions by parentId and expands children when their parent is in expandedParents.
 *
 * @param items - All session list items (sorted by updatedAt descending)
 * @param expandedParents - Set of parent session IDs that are expanded
 * @returns Flat array of rows with depth and expansion state
 */
export function buildSessionRows(
	items: readonly SessionListItem[],
	expandedParents: Set<string>
): SessionRow[] {
	// Group sessions by parentId
	const itemIds = new Set(items.map((item) => item.id));
	const childrenByParent = new Map<string, SessionListItem[]>();
	const roots: SessionListItem[] = [];

	for (const item of items) {
		if (item.parentId === null || !itemIds.has(item.parentId)) {
			roots.push(item);
		} else {
			const siblings = childrenByParent.get(item.parentId);
			if (siblings) {
				siblings.push(item);
			} else {
				childrenByParent.set(item.parentId, [item]);
			}
		}
	}

	// Build flat list with expanded children
	const rows: SessionRow[] = [];

	for (const root of roots) {
		const children = childrenByParent.get(root.id) ?? [];
		const hasChildren = children.length > 0;
		const isExpanded = expandedParents.has(root.id);

		// Add parent row
		rows.push({
			item: root,
			depth: 0,
			hasChildren,
			isExpanded,
		});

		// Add children if expanded
		if (isExpanded && hasChildren) {
			for (const child of children) {
				rows.push({
					item: child,
					depth: 1,
					hasChildren: false,
					isExpanded: false,
				});
			}
		}
	}

	return rows;
}

/**
 * Groups items by project.
 */
export function createSessionGroups(
	items: readonly SessionListItem[],
	projectCreatedAtMap?: Map<string, Date>,
	allProjects?: readonly Project[]
): SessionGroup[] {
	const groupMap = new Map<string, SessionGroup>();

	// Seed groups from all known projects so empty ones still appear
	if (allProjects) {
		for (const project of allProjects) {
			groupMap.set(project.path, {
				projectPath: project.path,
				projectName: project.name,
				projectColor: project.color,
				sessions: [],
			});
		}
	}

	for (const item of items) {
		let group = groupMap.get(item.projectPath);
		if (!group) {
			group = {
				projectPath: item.projectPath,
				projectName: item.projectName,
				projectColor: item.projectColor,
				sessions: [],
			};
			groupMap.set(item.projectPath, group);
		}
		group.sessions.push(item);
	}

	// Sort groups by project creation date (when project was added)
	return Array.from(groupMap.values()).sort((a, b) => {
		const aTime = projectCreatedAtMap?.get(a.projectPath)?.getTime() ?? 0;
		const bTime = projectCreatedAtMap?.get(b.projectPath)?.getTime() ?? 0;
		return bTime - aTime;
	});
}

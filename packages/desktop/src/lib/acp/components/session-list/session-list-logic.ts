import { computeProjectBadgeLabels } from "@acepe/ui/project-letter-badge";

import type { SessionEntry } from "../../application/dto/session-entry.js";
import type { SessionSummary } from "../../application/dto/session-summary.js";
import type { Project } from "../../logic/project-manager.svelte.js";
import type { Checkpoint } from "../../types/checkpoint.js";
import { extractProjectName } from "../../utils/path-utils.js";

import {
	createProjectColorMap,
	createProjectIconSrcMap,
	createProjectNameMap,
	generateFallbackProjectColor,
} from "../../utils/project-utils.js";
import type {
	SessionActivityInfo,
	SessionGroup,
	SessionListItem,
	TodoProgressInfo,
} from "./session-list-types.js";

export { createProjectColorMap, createProjectIconSrcMap, createProjectNameMap };

import type { ToolCall } from "../../types/tool-call.js";
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
	const projectBadgeLabelByPath = computeProjectBadgeLabels(
		projects.map((project) => ({ key: project.path, name: project.name }))
	);

	return projects
		.toSorted((a, b) => compareProjectOrder(a.sortOrder, a.createdAt, b.sortOrder, b.createdAt))
		.map((project) => ({
			projectPath: project.path,
			projectName: project.name,
			projectBadgeLabel: projectBadgeLabelByPath.get(project.path) ?? null,
			projectColor: project.color,
			projectIconSrc: project.iconPath ?? null,
			sessions: [],
		}));
}

export function extractTodoProgressFromToolCall(
	toolCall: Pick<ToolCall, "normalizedTodos"> | null
): TodoProgressInfo | null {
	const todos = toolCall?.normalizedTodos;
	if (!todos || todos.length === 0) {
		return null;
	}

	const inProgressIndex = todos.findIndex((todo) => todo.status === "in_progress");
	const completedCount = todos.filter((todo) => todo.status === "completed").length;

	let current: number;
	let label: string;

	if (inProgressIndex >= 0) {
		const inProgressTodo = todos[inProgressIndex];
		current = inProgressIndex + 1;
		label = inProgressTodo.activeForm || inProgressTodo.content;
	} else if (completedCount === todos.length) {
		current = completedCount;
		label = "Done";
	} else {
		current = completedCount;
		label = "Waiting";
	}

	return {
		current,
		total: todos.length,
		label: truncateText(label, 25),
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
 * diff stats and uses the canonical-derived session streaming flag.
 */
export function createDisplayItems(
	sessions: readonly SessionWithEntries[],
	projectNameMap: Map<string, string>,
	projectColorMap: Map<string, string>,
	projectIconSrcMap: Map<string, string | null>,
	openSessionIds: Set<string>,
	getCheckpoints?: (sessionId: string) => readonly Checkpoint[]
): SessionListItem[] {
	return sessions.map((session): SessionListItem => {
		const projectName =
			projectNameMap.get(session.projectPath) || extractProjectName(session.projectPath);
		const projectColor =
			projectColorMap.get(session.projectPath) ?? generateFallbackProjectColor(session.projectPath);
		const projectIconSrc = projectIconSrcMap.get(session.projectPath) ?? null;

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
			projectIconSrc,
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
			entryCount: session.entryCount,
			worktreePath: session.worktreePath,
			worktreeDeleted: session.worktreeDeleted,
			prNumber: session.prNumber,
			prState: session.prState,
			prLinkMode: session.prLinkMode,
			linkedPr: session.linkedPr,
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
 * Returns the sessions that should be rendered in the sidebar.
 *
 * Historical sessions remain visible so the project list never appears empty
 * when there are no currently open or streaming sessions.
 */
export function getSidebarSessions(sessions: readonly SessionListItem[]): SessionListItem[] {
	return Array.from(sessions);
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
	projectSortOrderMap?: Map<string, number>,
	allProjects?: readonly Project[]
): SessionGroup[] {
	const groupMap = new Map<string, SessionGroup>();
	const projectBadgeLabelByPath = getSessionGroupBadgeLabelMap(items, allProjects);

	// Seed groups from all known projects so empty ones still appear
	if (allProjects) {
		for (const project of allProjects) {
			groupMap.set(project.path, {
				projectPath: project.path,
				projectName: project.name,
				projectBadgeLabel: projectBadgeLabelByPath.get(project.path) ?? null,
				projectColor: project.color,
				projectIconSrc: project.iconPath ?? null,
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
				projectBadgeLabel: projectBadgeLabelByPath.get(item.projectPath) ?? null,
				projectColor: item.projectColor,
				projectIconSrc: item.projectIconSrc ?? null,
				sessions: [],
			};
			groupMap.set(item.projectPath, group);
		}
		group.sessions.push(item);
	}

	// Sort groups by persisted project order, with creation date as tie-breaker.
	return Array.from(groupMap.values()).sort((a, b) => {
		const aCreatedAt = projectCreatedAtMap?.get(a.projectPath);
		const bCreatedAt = projectCreatedAtMap?.get(b.projectPath);
		const aSortOrder = projectSortOrderMap?.get(a.projectPath);
		const bSortOrder = projectSortOrderMap?.get(b.projectPath);
		return compareProjectOrder(aSortOrder, aCreatedAt, bSortOrder, bCreatedAt);
	});
}

function getSessionGroupBadgeLabelMap(
	items: readonly SessionListItem[],
	allProjects: readonly Project[] | undefined
): Map<string, string> {
	if (allProjects !== undefined) {
		return computeProjectBadgeLabels(
			allProjects.map((project) => ({ key: project.path, name: project.name }))
		);
	}

	const projectNameByPath = new Map<string, string>();
	for (const item of items) {
		if (!projectNameByPath.has(item.projectPath)) {
			projectNameByPath.set(item.projectPath, item.projectName);
		}
	}

	return computeProjectBadgeLabels(
		Array.from(projectNameByPath.entries()).map(([key, name]) => ({ key, name }))
	);
}

function compareProjectOrder(
	aSortOrder: number | undefined,
	aCreatedAt: Date | undefined,
	bSortOrder: number | undefined,
	bCreatedAt: Date | undefined
): number {
	const normalizedASortOrder = aSortOrder ?? Number.POSITIVE_INFINITY;
	const normalizedBSortOrder = bSortOrder ?? Number.POSITIVE_INFINITY;

	if (normalizedASortOrder !== normalizedBSortOrder) {
		return normalizedASortOrder - normalizedBSortOrder;
	}

	const aTime = aCreatedAt?.getTime() ?? 0;
	const bTime = bCreatedAt?.getTime() ?? 0;
	return bTime - aTime;
}

/**
 * Resolve the default agent id to use when the `+` button is left-clicked on a
 * project row. The saved default wins when it is still available; otherwise we
 * fall back to the first available agent so the sidebar create button remains a
 * direct action instead of opening a second picker surface.
 */
export function resolveDefaultAgentIdForCreate(
	availableAgents: readonly { id: string }[],
	defaultAgentId: string | null | undefined
): string | undefined {
	if (defaultAgentId != null) {
		const defaultAgent = availableAgents.find((agent) => agent.id === defaultAgentId);
		if (defaultAgent) {
			return defaultAgent.id;
		}
	}

	const firstAvailableAgent = availableAgents[0];
	return firstAvailableAgent ? firstAvailableAgent.id : undefined;
}

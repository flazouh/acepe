import type { SessionSummary } from "$lib/acp/application/dto/session.js";
import { extractProjectName } from "$lib/acp/utils/path-utils.js";
import { createProjectColorMap, createProjectNameMap } from "$lib/acp/utils/project-utils.js";

import type {
	ProjectInfo,
	SessionTableRow,
	SortColumn,
	SortDirection,
} from "./session-table-types.js";

export { createProjectColorMap, createProjectNameMap };

/**
 * Gets unique projects from sessions.
 */
export function getUniqueProjects(
	sessions: readonly SessionSummary[],
	projectNameMap: Map<string, string>,
	projectColorMap: Map<string, string>
): ProjectInfo[] {
	const projectSet = new Set<string>();
	const result: ProjectInfo[] = [];

	for (const session of sessions) {
		if (!projectSet.has(session.projectPath)) {
			projectSet.add(session.projectPath);
			const name =
				projectNameMap.get(session.projectPath) || extractProjectName(session.projectPath);
			const color = projectColorMap.get(session.projectPath) || "#6b7280";
			result.push({ path: session.projectPath, name, color });
		}
	}

	return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Gets unique agent IDs from sessions.
 */
export function getUniqueAgents(sessions: readonly SessionSummary[]): string[] {
	const agents = new Set<string>();
	for (const session of sessions) {
		agents.add(session.agentId);
	}
	return Array.from(agents).sort();
}

/**
 * Converts session summaries to table rows.
 */
export function createTableRows(
	sessions: readonly SessionSummary[],
	projectNameMap: Map<string, string>,
	projectColorMap: Map<string, string>
): SessionTableRow[] {
	return sessions.map((session): SessionTableRow => {
		const projectName =
			projectNameMap.get(session.projectPath) || extractProjectName(session.projectPath);
		const projectColor = projectColorMap.get(session.projectPath) || "#6b7280";

		return {
			id: session.id,
			title: session.title || projectName,
			projectPath: session.projectPath,
			projectName,
			projectColor,
			agentId: session.agentId,
			status: session.status,
			entryCount: session.entryCount,
			isConnected: session.isConnected,
			isStreaming: session.isStreaming,
			updatedAt: session.updatedAt,
		};
	});
}

/**
 * Filters rows by search query, project, and agent.
 */
export function filterRows(
	rows: readonly SessionTableRow[],
	searchQuery: string,
	projectFilter: string | null,
	agentFilter: string | null
): SessionTableRow[] {
	let filtered = Array.from(rows);

	// Filter by search query
	const query = searchQuery.toLowerCase().trim();
	if (query) {
		filtered = filtered.filter(
			(row) =>
				row.title.toLowerCase().includes(query) ||
				row.projectName.toLowerCase().includes(query) ||
				row.agentId.toLowerCase().includes(query)
		);
	}

	// Filter by project
	if (projectFilter) {
		filtered = filtered.filter((row) => row.projectPath === projectFilter);
	}

	// Filter by agent
	if (agentFilter) {
		filtered = filtered.filter((row) => row.agentId === agentFilter);
	}

	return filtered;
}

/**
 * Sorts rows by column and direction.
 */
export function sortRows(
	rows: readonly SessionTableRow[],
	sortColumn: SortColumn,
	sortDirection: SortDirection
): SessionTableRow[] {
	const sorted = [...rows];
	const multiplier = sortDirection === "asc" ? 1 : -1;

	return sorted.sort((a, b) => {
		switch (sortColumn) {
			case "title":
				return multiplier * a.title.localeCompare(b.title);
			case "projectName":
				return multiplier * a.projectName.localeCompare(b.projectName);
			case "agentId":
				return multiplier * a.agentId.localeCompare(b.agentId);
			case "status":
				return multiplier * a.status.localeCompare(b.status);
			case "entryCount":
				return multiplier * (a.entryCount - b.entryCount);
			case "updatedAt":
				return multiplier * (a.updatedAt.getTime() - b.updatedAt.getTime());
			default:
				return 0;
		}
	});
}

/**
 * Paginates rows.
 */
export function paginateRows(
	rows: readonly SessionTableRow[],
	currentPage: number,
	pageSize: number
): SessionTableRow[] {
	const start = currentPage * pageSize;
	const end = start + pageSize;
	return rows.slice(start, end);
}

/**
 * Calculates total pages.
 */
export function calculateTotalPages(totalRows: number, pageSize: number): number {
	return Math.ceil(totalRows / pageSize);
}

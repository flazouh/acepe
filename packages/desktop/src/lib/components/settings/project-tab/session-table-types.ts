import type { SessionStatus } from "$lib/acp/application/dto/session.js";

/**
 * Row data for the session table.
 */
export interface SessionTableRow {
	id: string;
	title: string;
	projectPath: string;
	projectName: string;
	projectColor: string;
	agentId: string;
	status: SessionStatus;
	entryCount: number;
	isConnected: boolean;
	isStreaming: boolean;
	updatedAt: Date;
}

export interface SessionTableActionTarget {
	id: string;
	projectPath: string;
	agentId: string;
}

/**
 * Sort column options.
 */
export type SortColumn =
	| "title"
	| "projectName"
	| "agentId"
	| "status"
	| "entryCount"
	| "updatedAt";

/**
 * Sort direction.
 */
export type SortDirection = "asc" | "desc";

/**
 * Unique project info for filters.
 */
export interface ProjectInfo {
	path: string;
	name: string;
	color: string;
}

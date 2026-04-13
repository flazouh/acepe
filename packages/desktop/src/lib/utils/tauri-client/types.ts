/**
 * Shared types for Tauri command client.
 */

/**
 * Information about a project discovered from an agent.
 */
export interface ProjectInfo {
	/** Absolute path to the project */
	path: string;
	/** Agent source that discovered this project */
	agent_id: string;
	/** Whether this path is a git worktree instead of the main repo root */
	is_worktree: boolean;
}

/** Single timing stage for session load audit */
export interface TimingStage {
	name: string;
	ms: number;
}

/** Timing audit result for session load */
export interface SessionLoadTiming {
	agent: string;
	total_ms: number;
	stages: TimingStage[];
	entry_count: number;
	ok: boolean;
}

/**
 * Session counts for a specific project, keyed by agent ID.
 */
export interface ProjectSessionCounts {
	/** Absolute path to the project */
	path: string;
	/** Session counts per agent ID */
	counts: Record<string, number>;
}

export interface CustomAgentConfig {
	id: string;
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}

/** Session message returned from get_session_messages (matches claude-history SessionMessage) */
export interface HistorySessionMessage {
	type: string;
	message?: { role: string; content: unknown[] };
	session_id: string;
	uuid: string;
	parent_uuid?: string;
	timestamp: string;
	cwd?: string;
	git_branch?: string;
	version?: string;
}

/** Project data from backend (snake_case) */
export interface ProjectData {
	path: string;
	name: string;
	last_opened?: string;
	created_at: string;
	color: string;
	sort_order: number;
	icon_path?: string | null;
}

/** Thread list display settings */
export interface ArchivedSessionRef {
	sessionId: string;
	projectPath: string;
	agentId: string;
}

/** Thread list display settings */
export interface ThreadListSettings {
	hiddenProjects: string[];
	archivedSessions?: ArchivedSessionRef[];
}

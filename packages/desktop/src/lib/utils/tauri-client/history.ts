import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import type { HistoryEntry, StartupSessionsResponse } from "../../services/claude-history-types.js";
import type {
	ConvertedSession,
	SessionPlanResponse,
} from "../../services/converted-session-types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type {
	HistorySessionMessage,
	ProjectInfo,
	ProjectSessionCounts,
	SessionLoadTiming,
} from "./types.js";

const historyCommands = TAURI_COMMAND_CLIENT.history;

export const history = {
	auditSessionLoadTiming: (
		sessionId: string,
		projectPath: string,
		agentId: string,
		sourcePath?: string
	): ResultAsync<SessionLoadTiming, AppError> => {
		return historyCommands.audit_session_load_timing.invoke<SessionLoadTiming>({
			sessionId,
			projectPath,
			agentId,
			sourcePath,
		});
	},

	getUnifiedSession: (
		sessionId: string,
		projectPath: string,
		agentId: string,
		sourcePath?: string
	): ResultAsync<ConvertedSession | null, AppError> => {
		return historyCommands.get_unified_session.invoke<ConvertedSession | null>({
			sessionId,
			projectPath,
			agentId,
			sourcePath,
		});
	},

	getStartupSessions: (sessionIds: string[]): ResultAsync<StartupSessionsResponse, AppError> => {
		return historyCommands.get_startup_sessions.invoke<StartupSessionsResponse>({ sessionIds });
	},

	getUnifiedPlan: (
		sessionId: string,
		projectPath: string,
		agentId: string
	): ResultAsync<SessionPlanResponse | null, AppError> => {
		return historyCommands.get_unified_plan.invoke<SessionPlanResponse | null>({
			sessionId,
			projectPath,
			agentId,
		});
	},

	scanProjectSessions: (projectPaths: string[]): ResultAsync<HistoryEntry[], AppError> => {
		return historyCommands.scan_project_sessions.invoke<HistoryEntry[]>({ projectPaths });
	},

	discoverAllProjectsWithSessions: (): ResultAsync<HistoryEntry[], AppError> => {
		return historyCommands.discover_all_projects_with_sessions.invoke<HistoryEntry[]>();
	},

	listAllProjectPaths: (): ResultAsync<ProjectInfo[], AppError> => {
		return historyCommands.list_all_project_paths.invoke<ProjectInfo[]>();
	},

	countSessionsForProject: (projectPath: string): ResultAsync<ProjectSessionCounts, AppError> => {
		return historyCommands.count_sessions_for_project.invoke<ProjectSessionCounts>({ projectPath });
	},

	getSessionHistory: (): ResultAsync<HistoryEntry[], AppError> => {
		return historyCommands.get_session_history.invoke<HistoryEntry[]>();
	},

	getSessionMessages: (
		sessionId: string,
		projectPath: string
	): ResultAsync<HistorySessionMessage[], AppError> => {
		return historyCommands.get_session_messages.invoke<HistorySessionMessage[]>({
			sessionId,
			projectPath,
		});
	},

	getFullSession: (
		sessionId: string,
		projectPath: string
	): ResultAsync<import("../../services/converted-session-types.js").FullSession, AppError> => {
		return historyCommands.get_full_session.invoke<
			import("../../services/converted-session-types.js").FullSession
		>({
			sessionId,
			projectPath,
		});
	},

	getConvertedSession: (
		sessionId: string,
		projectPath: string
	): ResultAsync<ConvertedSession, AppError> => {
		return historyCommands.get_converted_session.invoke<ConvertedSession>({
			sessionId,
			projectPath,
		});
	},

	setSessionPrNumber: (sessionId: string, prNumber: number | null): ResultAsync<void, AppError> => {
		return historyCommands.set_session_pr_number.invoke<void>({ sessionId, prNumber });
	},

	setSessionTitle: (sessionId: string, title: string): ResultAsync<void, AppError> => {
		return historyCommands.set_session_title.invoke<void>({ sessionId, title });
	},

	setSessionWorktreePath: (
		sessionId: string,
		worktreePath: string,
		projectPath?: string,
		agentId?: string
	): ResultAsync<void, AppError> => {
		return historyCommands.set_session_worktree_path.invoke<void>({
			sessionId,
			worktreePath,
			projectPath,
			agentId,
		});
	},
};

import type { ResultAsync } from "neverthrow";

import type { SessionPrLinkMode } from "../../acp/application/dto/session-linked-pr.js";
import type { AppError } from "../../acp/errors/app-error.js";
import type { SessionOpenResult } from "../../services/acp-types.js";
import type { HistoryEntry, StartupSessionsResponse } from "../../services/claude-history-types.js";
import type { SessionPlanResponse } from "../../services/converted-session-types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type { ProjectInfo, ProjectSessionCounts, SessionLoadTiming } from "./types.js";

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

	getSessionOpenResult: (
		sessionId: string,
		projectPath: string,
		agentId: string,
		sourcePath?: string
	): ResultAsync<SessionOpenResult, AppError> => {
		return historyCommands.get_session_open_result.invoke<SessionOpenResult>({
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

	setSessionPrNumber: (
		sessionId: string,
		prNumber: number | null,
		prLinkMode?: SessionPrLinkMode | null
	): ResultAsync<void, AppError> => {
		return historyCommands.set_session_pr_number.invoke<void>({
			sessionId,
			prNumber,
			prLinkMode: prLinkMode ?? null,
		});
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

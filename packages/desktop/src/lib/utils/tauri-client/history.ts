import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type { HistoryEntry, StartupSessionsResponse } from "../../services/claude-history-types.js";
import type {
	ConvertedSession,
	SessionPlanResponse,
} from "../../services/converted-session-types.js";
import { CMD } from "./commands.js";

import { invokeAsync } from "./invoke.js";
import type {
	HistorySessionMessage,
	ProjectInfo,
	ProjectSessionCounts,
	SessionLoadTiming,
} from "./types.js";

export const history = {
	auditSessionLoadTiming: (
		sessionId: string,
		projectPath: string,
		agentId: string,
		sourcePath?: string
	): ResultAsync<SessionLoadTiming, AppError> => {
		return invokeAsync(CMD.history.audit_session_load_timing, {
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
		return invokeAsync(CMD.history.get_unified_session, {
			sessionId,
			projectPath,
			agentId,
			sourcePath,
		});
	},

	getStartupSessions: (sessionIds: string[]): ResultAsync<StartupSessionsResponse, AppError> => {
		return invokeAsync(CMD.history.get_startup_sessions, { sessionIds });
	},

	getUnifiedPlan: (
		sessionId: string,
		projectPath: string,
		agentId: string
	): ResultAsync<SessionPlanResponse | null, AppError> => {
		return invokeAsync(CMD.history.get_unified_plan, { sessionId, projectPath, agentId });
	},

	scanProjectSessions: (projectPaths: string[]): ResultAsync<HistoryEntry[], AppError> => {
		return invokeAsync(CMD.history.scan_project_sessions, { projectPaths });
	},

	discoverAllProjectsWithSessions: (): ResultAsync<HistoryEntry[], AppError> => {
		return invokeAsync(CMD.history.discover_all_projects_with_sessions);
	},

	listAllProjectPaths: (): ResultAsync<ProjectInfo[], AppError> => {
		return invokeAsync(CMD.history.list_all_project_paths);
	},

	countSessionsForProject: (projectPath: string): ResultAsync<ProjectSessionCounts, AppError> => {
		return invokeAsync(CMD.history.count_sessions_for_project, { projectPath });
	},

	getSessionHistory: (): ResultAsync<HistoryEntry[], AppError> => {
		return invokeAsync(CMD.history.get_session_history);
	},

	getSessionMessages: (
		sessionId: string,
		projectPath: string
	): ResultAsync<HistorySessionMessage[], AppError> => {
		return invokeAsync(CMD.history.get_session_messages, { sessionId, projectPath });
	},

	getFullSession: (
		sessionId: string,
		projectPath: string
	): ResultAsync<import("../../services/converted-session-types.js").FullSession, AppError> => {
		return invokeAsync(CMD.history.get_full_session, { sessionId, projectPath });
	},

	getConvertedSession: (
		sessionId: string,
		projectPath: string
	): ResultAsync<ConvertedSession, AppError> => {
		return invokeAsync(CMD.history.get_converted_session, { sessionId, projectPath });
	},

	getSessionPlan: (
		sessionId: string,
		projectPath: string
	): ResultAsync<SessionPlanResponse | null, AppError> => {
		return invokeAsync(CMD.history.get_session_plan, { sessionId, projectPath });
	},

	getPlanBySlug: (slug: string): ResultAsync<SessionPlanResponse | null, AppError> => {
		return invokeAsync(CMD.history.get_plan_by_slug, { slug });
	},

	listPlans: (): ResultAsync<SessionPlanResponse[], AppError> => {
		return invokeAsync(CMD.history.list_plans);
	},

	setSessionPrNumber: (sessionId: string, prNumber: number | null): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.history.set_session_pr_number, { sessionId, prNumber });
	},

	setSessionTitle: (sessionId: string, title: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.history.set_session_title, { sessionId, title });
	},

	setSessionWorktreePath: (
		sessionId: string,
		worktreePath: string,
		projectPath?: string,
		agentId?: string
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.history.set_session_worktree_path, {
			sessionId,
			worktreePath,
			projectPath,
			agentId,
		});
	},
};

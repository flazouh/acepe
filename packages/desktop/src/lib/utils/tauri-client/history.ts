import type * as Effect from "effect/Effect";

import type { SessionPrLinkMode } from "../../acp/application/dto/session-linked-pr.js";
import type { AppError } from "../../acp/errors/app-error.js";
import type { SessionOpenResult } from "../../services/acp-types.js";
import type { HistoryEntry, StartupSessionsResponse } from "../../services/claude-history-types.js";
import type { SessionPlanResponse } from "../../services/converted-session-types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import { unsupportedOnContract } from "./rpc-bridge.ts";
import type { ProjectInfo, ProjectSessionCounts, SessionLoadTiming } from "./types.js";

const historyCommands = TAURI_COMMAND_CLIENT.history;

export interface TranscriptRowLedgerBackfillResult {
	readonly requestedLimit: number;
	readonly candidateCount: number;
	readonly checkedCount: number;
	readonly rebuiltCount: number;
	readonly rebuiltFromProviderCount: number;
	readonly skippedCurrentCount: number;
	readonly skippedNoJournalCount: number;
	readonly skippedMissingFactsCount: number;
	readonly failedCount: number;
	readonly failedSessionIds: string[];
}

// getSessionOpenResult/getStartupSessions/scanProjectSessions/
// listAllProjectPaths/countSessionsForProject/getUnifiedPlan/
// warmRecentTranscriptRowLedgers/invalidateHistoryCache and the
// setSessionPrNumber/setSessionTitle/setSessionWorktreePath writers below all
// stay on TAURI_COMMAND_CLIENT: they read from and write to the Rust history
// backend's own SQLite index (multi-provider project discovery, session-open
// hydration+repair, the transcript-row-ledger cache), none of which has a
// TS/RPC counterpart yet. #249 batch 2's AC-040 importer only parses provider
// jsonl into the orchestration event store at import time — it does not walk
// provider directories at read time or serve session-open hydration. Moving
// only the writers onto the session.meta.update dispatch command (which
// already exists and would write the TS server's own ProjectionSessions
// table instead) would split the two stores: title/PR-link/worktree edits
// would stop showing up in the sidebar scan and in session-open hydration
// for anyone still on the Rust-backed readers. The whole read+write surface
// has to move together, which needs the provider-discovery and
// session-open/repair work this slice does not have budget for — see the
// #249 issue thread for the follow-up slice.
export const history = {
	// Diagnostic-only timing probe for the Rust session-load path; no live
	// caller today (see #249 batch 2 map).
	auditSessionLoadTiming: (
		_sessionId: string,
		_projectPath: string,
		_agentId: string,
		_sourcePath?: string
	): Effect.Effect<SessionLoadTiming, AppError> => {
		return unsupportedOnContract("history.auditSessionLoadTiming");
	},

	getSessionOpenResult: (
		sessionId: string,
		projectPath: string,
		agentId: string,
		sourcePath?: string,
		repairPriority: "selected" | "visible" | "backfill" = "selected"
	): Effect.Effect<SessionOpenResult, AppError> => {
		return historyCommands.get_session_open_result.invoke<SessionOpenResult>({
			sessionId,
			projectPath,
			agentId,
			sourcePath,
			repairPriority,
		});
	},

	awaitSessionOpenRepair: (repairTicket: string): Effect.Effect<SessionOpenResult, AppError> => {
		return historyCommands.await_session_open_repair.invoke<SessionOpenResult>({ repairTicket });
	},

	getStartupSessions: (sessionIds: string[]): Effect.Effect<StartupSessionsResponse, AppError> => {
		return historyCommands.get_startup_sessions.invoke<StartupSessionsResponse>({ sessionIds });
	},

	warmRecentTranscriptRowLedgers: (
		limit?: number
	): Effect.Effect<TranscriptRowLedgerBackfillResult, AppError> => {
		return historyCommands.warm_recent_transcript_row_ledgers.invoke<TranscriptRowLedgerBackfillResult>(
			{
				limit: limit ?? null,
			}
		);
	},

	getUnifiedPlan: (
		sessionId: string,
		projectPath: string,
		agentId: string
	): Effect.Effect<SessionPlanResponse | null, AppError> => {
		return historyCommands.get_unified_plan.invoke<SessionPlanResponse | null>({
			sessionId,
			projectPath,
			agentId,
		});
	},

	scanProjectSessions: (projectPaths: string[]): Effect.Effect<HistoryEntry[], AppError> => {
		return historyCommands.scan_project_sessions.invoke<HistoryEntry[]>({ projectPaths });
	},

	invalidateHistoryCache: (): Effect.Effect<void, AppError> => {
		return historyCommands.invalidate_history_cache.invoke<void>();
	},

	// Whole-machine provider-directory discovery; no live caller today (see
	// #249 batch 2 map). listAllProjectPaths/scanProjectSessions cover the
	// callers this facade actually has.
	discoverAllProjectsWithSessions: (): Effect.Effect<HistoryEntry[], AppError> => {
		return unsupportedOnContract("history.discoverAllProjectsWithSessions");
	},

	listAllProjectPaths: (): Effect.Effect<ProjectInfo[], AppError> => {
		return historyCommands.list_all_project_paths.invoke<ProjectInfo[]>();
	},

	countSessionsForProject: (projectPath: string): Effect.Effect<ProjectSessionCounts, AppError> => {
		return historyCommands.count_sessions_for_project.invoke<ProjectSessionCounts>({ projectPath });
	},

	setSessionPrNumber: (
		sessionId: string,
		prNumber: number | null,
		prLinkMode?: SessionPrLinkMode | null
	): Effect.Effect<void, AppError> => {
		return historyCommands.set_session_pr_number.invoke<void>({
			sessionId,
			prNumber,
			prLinkMode: prLinkMode ?? null,
		});
	},

	setSessionTitle: (sessionId: string, title: string): Effect.Effect<void, AppError> => {
		return historyCommands.set_session_title.invoke<void>({ sessionId, title });
	},

	setSessionWorktreePath: (
		sessionId: string,
		worktreePath: string,
		projectPath?: string,
		agentId?: string
	): Effect.Effect<void, AppError> => {
		return historyCommands.set_session_worktree_path.invoke<void>({
			sessionId,
			worktreePath,
			projectPath,
			agentId,
		});
	},
};

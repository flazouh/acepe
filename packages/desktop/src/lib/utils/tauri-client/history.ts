import {
	decodeSessionId,
	type DiscoveredProviderSession,
	SessionMetaUpdateCommand,
	SessionPrNumber,
	type TrimmedNonEmptyString,
} from "@acepe/contracts";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { SessionPrLinkMode } from "../../acp/application/dto/session-linked-pr.js";
import type { AppError } from "../../acp/errors/app-error.js";
import type { SessionOpenResult } from "../../services/acp-types.js";
import type { HistoryEntry, StartupSessionsResponse } from "../../services/claude-history-types.js";
import type { SessionPlanResponse } from "../../services/converted-session-types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import { decodeTrimmed, decodeEffect, nextCommandId, unsupportedOnContract, withRpcClient } from "./rpc-bridge.ts";
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

// Read-time provider discovery (#249 batch 3): scanProjectSessions/
// getStartupSessions/listAllProjectPaths/countSessionsForProject now scan
// Claude Code's own JSONL directories through listProviderSessions/
// listProviderProjects (see ../../rpc/client.ts), independent of whether
// Acepe has imported a given session into the orchestration event store.
// setSessionTitle/setSessionPrNumber write through session.meta.update,
// calling importProviderSession first so a rename on a not-yet-imported
// session creates it (idempotent when already imported -- see
// packages/server/src/rpc/handlers.ts:importProviderSessionHandler).
//
// getSessionOpenResult/awaitSessionOpenRepair/getUnifiedPlan/
// warmRecentTranscriptRowLedgers/invalidateHistoryCache/
// setSessionWorktreePath stay on TAURI_COMMAND_CLIENT: full session-content
// hydration+repair and worktree-path tracking have no TS/RPC counterpart yet
// (worktreePath is not a field the orchestration model tracks per-session).
// See the #249 issue thread for the follow-up slice.
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
		if (sessionIds.length === 0) {
			return Effect.succeed({ entries: [], aliasRemaps: {} });
		}
		const wanted = new Set(sessionIds);
		return allDiscoveredSessions().pipe(
			Effect.map((sessions) => ({
				entries: sessions
					.filter((session) => wanted.has(session.id))
					.map(discoveredSessionToHistoryEntry),
				// Discovery's session id already is the provider's own id (no
				// separate alias concept the way the Rust index had one for
				// provider_session_id vs its own row id), so there is nothing
				// to remap.
				aliasRemaps: {},
			}))
		);
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
		return Effect.forEach(
			projectPaths,
			(projectPath) =>
				decodeTrimmed("history.scanProjectSessions", projectPath).pipe(
					Effect.flatMap((decodedPath) =>
						withRpcClient("history.scanProjectSessions", (client) =>
							client.listProviderSessions(decodedPath)
						)
					)
				),
			{ concurrency: "unbounded" }
		).pipe(Effect.map((results) => results.flat().map(discoveredSessionToHistoryEntry)));
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
		return withRpcClient("history.listAllProjectPaths", (client) => client.listProviderProjects()).pipe(
			Effect.map((projects) =>
				projects.map((project) => ({
					path: project.projectPath,
					agent_id: "claude-code",
					// Discovery does not determine worktree-vs-main-repo status
					// (#249 batch 3 scope) -- every discovered project reports as
					// a main repo until a follow-up slice adds that check.
					is_worktree: false,
				}))
			)
		);
	},

	countSessionsForProject: (projectPath: string): Effect.Effect<ProjectSessionCounts, AppError> => {
		return decodeTrimmed("history.countSessionsForProject", projectPath).pipe(
			Effect.flatMap((decodedPath) =>
				withRpcClient("history.countSessionsForProject", (client) =>
					client.listProviderSessions(decodedPath)
				)
			),
			Effect.map((sessions) => ({
				path: projectPath,
				counts: { "claude-code": sessions.length },
			}))
		);
	},

	setSessionPrNumber: (
		sessionId: string,
		prNumber: number | null,
		prLinkMode?: SessionPrLinkMode | null
	): Effect.Effect<void, AppError> => {
		return setSessionPrNumberEffect(sessionId, prNumber, prLinkMode);
	},

	setSessionTitle: (sessionId: string, title: string): Effect.Effect<void, AppError> => {
		return setSessionTitleEffect(sessionId, title);
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

const discoveredSessionToHistoryEntry = (session: DiscoveredProviderSession): HistoryEntry => ({
	id: session.id,
	display: session.title,
	timestamp: session.createdAtMs,
	project: session.projectPath,
	sessionId: session.id,
	agentId: "claude-code",
	updatedAt: session.updatedAtMs,
	sourcePath: session.sourcePath,
	// Discovery only ever returns sessions with a real jsonl file backing
	// them, so every scanned entry counts as "persisted" the way the Rust
	// index used the same field to mean "has content on disk".
	sessionLifecycleState: "persisted",
});

// Every discovered project's sessions, fanned out across
// listProviderProjects + listProviderSessions. The server-side discovery
// scan caches per-directory by mtime signature, so repeat calls are cheap;
// this is still an O(projects) RPC fan-out per call, acceptable for the
// startup-hydration and rename-time lookups that use it (not a hot path).
const allDiscoveredSessions = (): Effect.Effect<ReadonlyArray<DiscoveredProviderSession>, AppError> =>
	withRpcClient("history.allDiscoveredSessions", (client) => client.listProviderProjects()).pipe(
		Effect.flatMap((projects) =>
			Effect.forEach(
				projects,
				(project) =>
					withRpcClient("history.allDiscoveredSessions", (client) =>
						client.listProviderSessions(project.projectPath)
					),
				{ concurrency: "unbounded" }
			)
		),
		Effect.map((results) => results.flat())
	);

// Finds the discovered project a given provider session lives under, by
// scanning every discovered project (there is no id -> project index on the
// wire yet). Returns None for a session Acepe created live and never
// touched provider discovery -- not every session has a project on disk.
const findProviderSessionProjectPath = (
	sessionId: TrimmedNonEmptyString
): Effect.Effect<Option.Option<TrimmedNonEmptyString>, AppError> =>
	withRpcClient("history.findProviderSessionProjectPath", (client) => client.listProviderProjects()).pipe(
		Effect.flatMap((projects) =>
			Effect.forEach(
				projects,
				(project) =>
					withRpcClient("history.findProviderSessionProjectPath", (client) =>
						client.listProviderSessions(project.projectPath)
					).pipe(
						Effect.map((sessions): Option.Option<TrimmedNonEmptyString> =>
							sessions.some((session) => session.id === sessionId)
								? Option.some(project.projectPath)
								: Option.none()
						)
					),
				{ concurrency: "unbounded" }
			)
		),
		Effect.map((results) => Arr.head(Arr.getSomes(results)))
	);

// Rename-triggers-import: a writer touching a session that has never been
// imported must create it first (idempotent no-op via deterministic
// commandIds when it is already imported -- see importProviderSessionHandler
// in packages/server/src/rpc/handlers.ts) so the session.meta.update below
// has a session to update.
const ensureProviderSessionImported = Effect.fn("history.ensureProviderSessionImported")(function* (
	sessionId: string
) {
	const decodedSessionId = yield* decodeTrimmed("history.ensureProviderSessionImported", sessionId);
	const projectPath = yield* findProviderSessionProjectPath(decodedSessionId);
	if (Option.isNone(projectPath)) {
		return;
	}
	yield* withRpcClient("history.ensureProviderSessionImported", (client) =>
		client.importProviderSession({
			provider: "claude",
			projectPath: projectPath.value,
			sessionId: decodedSessionId,
		})
	);
});

const setSessionTitleEffect = Effect.fn("history.setSessionTitle")(function* (
	sessionId: string,
	title: string
) {
	yield* ensureProviderSessionImported(sessionId);
	const decodedSessionId = yield* decodeEffect("history.setSessionTitle", decodeSessionId)(sessionId);
	const decodedTitle = yield* decodeTrimmed("history.setSessionTitle", title);
	const commandId = yield* nextCommandId("session-meta-update-title");
	yield* withRpcClient("history.setSessionTitle", (client) =>
		client.dispatch(
			SessionMetaUpdateCommand.make({
				type: "session.meta.update",
				commandId,
				sessionId: decodedSessionId,
				title: decodedTitle,
			})
		)
	);
});

const decodeSessionPrNumber = Schema.decodeUnknownEffect(SessionPrNumber);

const setSessionPrNumberEffect = Effect.fn("history.setSessionPrNumber")(function* (
	sessionId: string,
	prNumber: number | null,
	prLinkMode?: SessionPrLinkMode | null
) {
	yield* ensureProviderSessionImported(sessionId);
	const decodedSessionId = yield* decodeEffect("history.setSessionPrNumber", decodeSessionId)(sessionId);
	const decodedPrNumber =
		prNumber === null
			? null
			: yield* decodeEffect("history.setSessionPrNumber", decodeSessionPrNumber)(prNumber);
	const commandId = yield* nextCommandId("session-meta-update-pr");
	const base = {
		type: "session.meta.update" as const,
		commandId,
		sessionId: decodedSessionId,
		prNumber: decodedPrNumber,
	};
	// prLinkMode is an optionalKey, not nullable, on the command -- omit it
	// entirely rather than passing null through.
	const command =
		prLinkMode === undefined || prLinkMode === null
			? SessionMetaUpdateCommand.make(base)
			: SessionMetaUpdateCommand.make({ ...base, prLinkMode });
	yield* withRpcClient("history.setSessionPrNumber", (client) => client.dispatch(command));
});

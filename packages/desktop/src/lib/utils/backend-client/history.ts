import {
	type DiscoveredProviderSession,
	decodeSessionId,
	SessionMetaUpdateCommand,
	SessionPrNumber,
	sessionSnapshotRequest,
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
import {
	decodeEffect,
	decodeTrimmed,
	nextCommandId,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";
import type { ProjectInfo, ProjectSessionCounts, SessionLoadTiming } from "./types.js";

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
// setSessionWorktreePath are now honestly unsupportedOnContract rather than
// routed through the generated command client. This is not a behaviour regression:
// verified there is no get_session_open_result/await_session_open_repair/
// get_unified_plan/warm_recent_transcript_row_ledgers/
// invalidate_history_cache/set_session_worktree_path handler anywhere in
// packages/electrobun-shell or packages/server, so every one of these calls
// already failed on every invocation under the current Electrobun app --
// this makes that failure typed and explicit instead of an unresolved
// command invoke with no receiver.
//
// Real follow-up work, out of scope for this slice (each is its own sized
// piece): getSessionOpenResult/awaitSessionOpenRepair need the full
// session-content hydration+repair payload (transcript, operations,
// interactions, turn state, capabilities -- see SessionOpenResult in
// acp-types.ts) mapped from the orchestration session snapshot, which the
// projector does not carry today (see the projector.ts no-ops for
// SessionModelSet/SessionModeSet/etc -- the same gap this method would need
// closed first). setSessionWorktreePath needs a worktreePath field added to
// session.meta.update (contract + decider + projector + a migration), not
// just a facade change. See the #249 issue thread.
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
		_sessionId: string,
		_projectPath: string,
		_agentId: string,
		_sourcePath?: string,
		_repairPriority: "selected" | "visible" | "backfill" = "selected"
	): Effect.Effect<SessionOpenResult, AppError> => {
		return unsupportedOnContract("history.getSessionOpenResult");
	},

	awaitSessionOpenRepair: (_repairTicket: string): Effect.Effect<SessionOpenResult, AppError> => {
		return unsupportedOnContract("history.awaitSessionOpenRepair");
	},

	getStartupSessions: (sessionIds: string[]): Effect.Effect<StartupSessionsResponse, AppError> => {
		if (sessionIds.length === 0) {
			return Effect.succeed({ entries: [], aliasRemaps: {} });
		}
		const wanted = new Set(sessionIds);
		return allDiscoveredSessions().pipe(
			Effect.flatMap((sessions) => {
				const direct = sessions.filter((session) => wanted.has(session.id));
				const foundIds = new Set(direct.map((session) => session.id));
				const unresolved = sessionIds.filter((id) => !foundIds.has(id));
				if (unresolved.length === 0) {
					return Effect.succeed({
						entries: direct.map(discoveredSessionToHistoryEntry),
						aliasRemaps: {},
					});
				}
				// A requested id with no direct disk match might be the
				// ORCHESTRATION session id of one of the sessions already
				// discovered above -- the same session's other permanent id
				// (see RpcProjectedSession.providerSessionId's doc). Resolve
				// each candidate's own projection to find out.
				return Effect.forEach(
					unresolved,
					(aliasId) => resolveProviderSessionAlias(aliasId, sessions),
					{ concurrency: "unbounded" }
				).pipe(
					Effect.map((resolved) => {
						const aliasRemaps: Record<string, string> = {};
						const aliased: DiscoveredProviderSession[] = [];
						for (const outcome of resolved) {
							if (outcome === null) {
								continue;
							}
							aliasRemaps[outcome.aliasId] = outcome.session.id;
							aliased.push(outcome.session);
						}
						return {
							entries: [...direct, ...aliased].map(discoveredSessionToHistoryEntry),
							aliasRemaps,
						};
					})
				);
			})
		);
	},

	warmRecentTranscriptRowLedgers: (
		_limit?: number
	): Effect.Effect<TranscriptRowLedgerBackfillResult, AppError> => {
		return unsupportedOnContract("history.warmRecentTranscriptRowLedgers");
	},

	getUnifiedPlan: (
		_sessionId: string,
		_projectPath: string,
		_agentId: string
	): Effect.Effect<SessionPlanResponse | null, AppError> => {
		return unsupportedOnContract("history.getUnifiedPlan");
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
		return unsupportedOnContract("history.invalidateHistoryCache");
	},

	// Whole-machine provider-directory discovery; no live caller today (see
	// #249 batch 2 map). listAllProjectPaths/scanProjectSessions cover the
	// callers this facade actually has.
	discoverAllProjectsWithSessions: (): Effect.Effect<HistoryEntry[], AppError> => {
		return unsupportedOnContract("history.discoverAllProjectsWithSessions");
	},

	listAllProjectPaths: (): Effect.Effect<ProjectInfo[], AppError> => {
		return withRpcClient("history.listAllProjectPaths", (client) =>
			client.listProviderProjects()
		).pipe(
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
		_sessionId: string,
		_worktreePath: string,
		_projectPath?: string,
		_agentId?: string
	): Effect.Effect<void, AppError> => {
		return unsupportedOnContract("history.setSessionWorktreePath");
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

// Resolves one requested startup id that had no direct disk match: decodes
// it as an orchestration SessionId, fetches ITS OWN session projection, and
// checks whether the provider_session_id fact it carries (see
// ProjectionSessions.ts server-side) names one of the sessions this app run
// already discovered on disk. Best-effort: a decode failure or a snapshot
// with no learned provider session id just means this id is not an alias --
// it does not fail the whole startup batch (mirrors the chunk-level
// catch in session-repository.ts's loadStartupSessions).
const resolveProviderSessionAlias = (
	aliasId: string,
	discovered: ReadonlyArray<DiscoveredProviderSession>
): Effect.Effect<{ aliasId: string; session: DiscoveredProviderSession } | null, never> =>
	decodeEffect(
		"history.getStartupSessions",
		decodeSessionId
	)(aliasId).pipe(
		Effect.flatMap((decodedSessionId) =>
			withRpcClient("history.getStartupSessions", (client) =>
				client.snapshot(sessionSnapshotRequest(decodedSessionId))
			)
		),
		Effect.map((snapshot) => {
			const providerSessionId = snapshot.session?.providerSessionId ?? null;
			if (providerSessionId === null) {
				return null;
			}
			const match = discovered.find((session) => session.id === providerSessionId);
			return match === undefined ? null : { aliasId, session: match };
		}),
		Effect.catch(() => Effect.succeed(null))
	);

// Every discovered project's sessions, fanned out across
// listProviderProjects + listProviderSessions. The server-side discovery
// scan caches per-directory by mtime signature, so repeat calls are cheap;
// this is still an O(projects) RPC fan-out per call, acceptable for the
// startup-hydration and rename-time lookups that use it (not a hot path).
const allDiscoveredSessions = (): Effect.Effect<
	ReadonlyArray<DiscoveredProviderSession>,
	AppError
> =>
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
	withRpcClient("history.findProviderSessionProjectPath", (client) =>
		client.listProviderProjects()
	).pipe(
		Effect.flatMap((projects) =>
			Effect.forEach(
				projects,
				(project) =>
					withRpcClient("history.findProviderSessionProjectPath", (client) =>
						client.listProviderSessions(project.projectPath)
					).pipe(
						Effect.map(
							(sessions): Option.Option<TrimmedNonEmptyString> =>
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
// has a session to update. Exported so reopen-session hydration
// (reopened-session-hydrator.ts) can reuse the same idempotent
// discover-project-then-import step for a session that was scanned from
// disk (~/.claude) but never opened/renamed/PR-linked in this app run yet,
// instead of re-deriving its own project-path lookup.
export const ensureProviderSessionImported = Effect.fn("history.ensureProviderSessionImported")(
	function* (sessionId: string) {
		const decodedSessionId = yield* decodeTrimmed(
			"history.ensureProviderSessionImported",
			sessionId
		);
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
	}
);

const setSessionTitleEffect = Effect.fn("history.setSessionTitle")(function* (
	sessionId: string,
	title: string
) {
	yield* ensureProviderSessionImported(sessionId);
	const decodedSessionId = yield* decodeEffect(
		"history.setSessionTitle",
		decodeSessionId
	)(sessionId);
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
	const decodedSessionId = yield* decodeEffect(
		"history.setSessionPrNumber",
		decodeSessionId
	)(sessionId);
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

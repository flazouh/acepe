/**
 * Session Repository - Handles session CRUD and history loading.
 *
 * Responsibilities:
 * - Session CRUD operations (add, update, remove)
 * - History loading from persisted provider-owned session files
 * - Session preloading and scanning
 * - Converting history entries to Session format
 *
 * This service is extracted from SessionStore to separate concerns
 * and reduce the God class anti-pattern.
 */

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { buildPartialSessionLinkedPr, type SessionPrLinkMode } from "../../application/dto/session-linked-pr.js";
import type { HistoryEntry } from "../../../services/claude-history-types.js";
import { tauriClient } from "../../../utils/tauri-client.js";
import { AgentError, type AppError } from "../../errors/app-error.js";
import { createLogger } from "../../utils/logger.js";
import { api } from "../api.js";
import { isFallbackSessionTitle, stripArtifactsFromTitle } from "../session-title-policy.js";
import type { SessionCold } from "../types.js";
import type {
	IConnectionManager,
	IEntryManager,
	ISessionStateReader,
	ISessionStateWriter,
} from "./interfaces/index.js";

const logger = createLogger({ id: "session-repository", name: "SessionRepository" });

function isReplaceableSessionTitle(title: string | null | undefined): boolean {
	if (title === null || title === undefined) {
		return true;
	}

	const trimmedTitle = title.trim();
	if (trimmedTitle === "") {
		return true;
	}

	if (isFallbackSessionTitle(trimmedTitle)) {
		return true;
	}

	const strippedTitle = stripArtifactsFromTitle(trimmedTitle).trim();
	return strippedTitle === "" && trimmedTitle !== "";
}

function resolveSessionTitle(
	scannedTitle: string | null,
	existingTitle: string | null
): string | null {
	if (
		existingTitle !== null &&
		existingTitle !== undefined &&
		!isReplaceableSessionTitle(existingTitle)
	) {
		return existingTitle;
	}

	if (
		scannedTitle !== null &&
		scannedTitle !== undefined &&
		!isReplaceableSessionTitle(scannedTitle)
	) {
		return scannedTitle;
	}

	if (scannedTitle !== null && scannedTitle !== undefined && scannedTitle !== "") {
		return scannedTitle;
	}

	if (existingTitle !== null && existingTitle !== undefined && existingTitle !== "") {
		return existingTitle;
	}

	return null;
}

function normalizeSessionPrLinkMode(
	prNumber: number | null | undefined,
	prLinkMode: string | null | undefined
): SessionPrLinkMode | undefined {
	if (prLinkMode === "automatic" || prLinkMode === "manual") {
		return prLinkMode;
	}

	return prNumber == null ? undefined : "automatic";
}

/**
 * Repository for session persistence and loading operations.
 */
export class SessionRepository {
	constructor(
		private readonly stateReader: ISessionStateReader,
		private readonly stateWriter: ISessionStateWriter,
		private readonly entryManager: IEntryManager,
		private readonly connectionManager: IConnectionManager
	) {}

	// ============================================
	// SESSION CRUD
	// ============================================

	/**
	 * Add a session to the store.
	 */
	addSession(session: SessionCold): void {
		this.stateWriter.addSession(session);
		logger.debug("Added session", { sessionId: session.id });
	}

	/**
	 * Remove a session from the store.
	 */
	removeSession(sessionId: string): void {
		const allSessions = this.stateReader.getAllSessions();
		const filteredSessions = allSessions.filter((s) => s.id !== sessionId);
		this.stateWriter.setSessions(filteredSessions);

		this.connectionManager.setConnecting(sessionId, false);
		this.connectionManager.removeMachine(sessionId);
		this.entryManager.clearEntries(sessionId);
		logger.debug("Removed session", { sessionId });
	}

	/**
	 * Update a session by ID.
	 */
	updateSession(id: string, updates: Partial<SessionCold>): void {
		this.stateWriter.updateSession(id, updates);
	}

	// ============================================
	// HISTORY LOADING
	// ============================================

	/**
	 * Load sessions from history (from ALL agents).
	 *
	 * Merges with existing sessions to preserve loaded state:
	 * - Sessions already loaded via loadSessionById keep their title and loaded state
	 * - New sessions from history are added
	 * - Sessions not in history but currently loaded are preserved
	 */
	loadSessions(
		existingSessions: SessionCold[],
		projectPaths?: string[]
	): ResultAsync<SessionCold[], AppError> {
		// If no project paths provided, return existing sessions as-is
		if (!projectPaths || projectPaths.length === 0) {
			logger.debug("No project paths provided, returning existing sessions");
			return okAsync(existingSessions);
		}

		this.stateWriter.setLoading(true);
		logger.debug("Loading sessions from all agents", {
			projectPathsFilter: projectPaths,
		});

		return api
			.scanSessions(projectPaths)
			.map((entries) => {
				const mergedSessions = this.mergeHistoryWithExisting(entries, existingSessions);
				this.stateWriter.setSessions(mergedSessions);
				this.stateWriter.setLoading(false);
				logger.debug("Loaded sessions from all agents", {
					total: mergedSessions.length,
				});
				return mergedSessions;
			})
			.mapErr((error) => {
				this.stateWriter.setLoading(false);
				logger.error("Failed to load sessions", error);
				return error;
			});
	}

	/**
	 * Scan project sessions from all agents and refresh the store.
	 *
	 * The backend uses the SQLite index for Claude sessions (fast) and
	 * file scanning for other agents — all transparent to the frontend.
	 */
	scanSessions(
		_existingSessions: SessionCold[],
		projectPaths: string[]
	): ResultAsync<void, AppError> {
		if (projectPaths.length === 0) {
			return okAsync(undefined);
		}

		logger.debug("Scanning project sessions", { projectPaths });
		this.stateWriter.addScanningProjects(projectPaths);

		return tauriClient.history
			.scanProjectSessions(projectPaths)
			.map((entries) => {
				// Read fresh sessions to avoid stale snapshot overwrites from concurrent scans
				const freshSessions = this.stateReader.getAllSessions();
				this.refreshSessionsFromScan(freshSessions, entries, projectPaths);
				this.stateWriter.removeScanningProjects(projectPaths);
				logger.debug("Scan complete", { total: entries.length });
			})
			.mapErr((error) => {
				this.stateWriter.removeScanningProjects(projectPaths);
				logger.error("Scan failed", error);
				return error;
			});
	}

	/**
	 * Refresh sessions from a batch scan result.
	 *
	 * When `scannedProjectPaths` is provided, sessions belonging to those
	 * projects that are NOT in `entries` are pruned from the store. This is
	 * how per-project visibility toggles (e.g. "Hide external CLI sessions")
	 * take effect on re-scan: the backend filter removes them from `entries`,
	 * and this function removes them from the in-memory store.
	 *
	 * Transient (just-created) sessions and sessions the user has actively
	 * preloaded are always preserved to avoid dropping work in progress.
	 */
	refreshSessionsFromScan(
		existingSessions: SessionCold[],
		entries: HistoryEntry[],
		scannedProjectPaths?: readonly string[]
	): void {
		const rescannedProjects = new Set(scannedProjectPaths ?? []);
		if (entries.length === 0 && rescannedProjects.size === 0) {
			return;
		}

		logger.debug("Refreshing sessions from scan", { count: entries.length });

		// Deduplicate entries by sessionId (keep the one with latest updatedAt)
		const deduplicatedEntries = this.deduplicateEntries(entries);

		// Build a map of existing sessions for O(1) lookup
		const existingSessionsMap = new Map(existingSessions.map((s) => [s.id, s]));

		// Convert and merge all scanned entries
		const mergedSessions: SessionCold[] = [];

		for (const entry of deduplicatedEntries) {
			const scannedSession = this.historyEntryToSession(entry);
			const existingSession = existingSessionsMap.get(scannedSession.id);

			if (existingSession) {
				const title = resolveSessionTitle(scannedSession.title, existingSession.title);

				// Merge with existing session - update metadata from scan
				mergedSessions.push({
					...existingSession,
					title,
					updatedAt: scannedSession.updatedAt,
					sourcePath: scannedSession.sourcePath
						? scannedSession.sourcePath
						: existingSession.sourcePath,
					sessionLifecycleState: scannedSession.sessionLifecycleState
						? scannedSession.sessionLifecycleState
						: existingSession.sessionLifecycleState,
					parentId: scannedSession.parentId ?? existingSession.parentId,
					worktreePath: scannedSession.worktreePath ?? existingSession.worktreePath,
					prNumber: scannedSession.prNumber ?? existingSession.prNumber,
					sequenceId: scannedSession.sequenceId ?? existingSession.sequenceId,
				});

				existingSessionsMap.delete(scannedSession.id);
			} else {
				// New session from scan
				mergedSessions.push(scannedSession);
			}
		}

		// Keep any existing sessions that weren't in the scan results.
		// Pruning only applies to sessions whose project was rescanned.
		// We additionally preserve transient sessions and any session the
		// user has actively preloaded — dropping a loaded session out from
		// under the user would be worse than leaving a stale entry around
		// until the next successful scan.
		for (const existingSession of existingSessionsMap.values()) {
			const rescannedProject = rescannedProjects.has(existingSession.projectPath);
			const preserveTransientSession = existingSession.sessionLifecycleState === "created";
			const preservePreloadedSession = this.entryManager.isPreloaded(existingSession.id);
			if (!rescannedProject || preserveTransientSession || preservePreloadedSession) {
				mergedSessions.push(existingSession);
			}
		}

		// Sort by updatedAt DESC
		mergedSessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

		this.stateWriter.setSessions(mergedSessions);
		logger.debug("Sessions refreshed from scan", { count: mergedSessions.length });
	}

	/**
	 * Load startup sessions (hydrate sessions that should be open at startup).
	 *
	 * Returns the list of missing session IDs and an alias remap map.
	 * The alias remap maps requested alias IDs (provider_session_id values)
	 * to their canonical Acepe session IDs, enabling the caller to rewrite
	 * panel session references before validation.
	 */
	loadStartupSessions(
		existingSessions: SessionCold[],
		sessionIds: string[]
	): ResultAsync<{ missing: string[]; aliasRemaps: Record<string, string> }, AppError> {
		if (sessionIds.length === 0) {
			return okAsync({ missing: [], aliasRemaps: {} });
		}

		logger.debug("Loading startup sessions", { sessionIds });

		const loadedIds = new Set(existingSessions.map((s) => s.id));
		const sessionIdsToFetch = sessionIds.filter((id) => !loadedIds.has(id));

		if (sessionIdsToFetch.length === 0) {
			logger.debug("All startup sessions already loaded");
			return okAsync({ missing: [], aliasRemaps: {} });
		}

		return api.getStartupSessions(sessionIdsToFetch).map((response) => {
			// Build alias remaps from the response, filtering out null values from Partial<>.
			const aliasRemaps: Record<string, string> = {};
			for (const [aliasId, canonicalId] of Object.entries(response.aliasRemaps)) {
				if (canonicalId !== undefined && canonicalId !== null) {
					aliasRemaps[aliasId] = canonicalId;
				}
			}

			const mergedSessions = this.reconcileAliasedStartupSessions(
				this.mergeHistoryWithExisting(response.entries, existingSessions),
				existingSessions,
				aliasRemaps
			);
			this.stateWriter.setSessions(mergedSessions);

			const foundIds = new Set(mergedSessions.map((session) => session.id));
			// A session matched by alias will have its canonical ID in foundIds.
			// The original alias ID should not be reported as missing.
			const aliasedIds = new Set(Object.keys(aliasRemaps));
			const missing = sessionIds.filter((id) => !foundIds.has(id) && !aliasedIds.has(id));

			if (missing.length > 0) {
				logger.debug("Startup sessions not found (likely deleted)", { missing });
			}
			if (Object.keys(aliasRemaps).length > 0) {
				logger.debug("Startup sessions matched by alias", { aliasRemaps });
			}

			return { missing, aliasRemaps };
		});
	}

	/**
	 * Preload full session details from the provider-owned persisted history.
	 */
	preloadSessions(
		sessionIds: string[]
	): ResultAsync<{ loaded: SessionCold[]; missing: string[] }, AppError> {
		if (sessionIds.length === 0) {
			return okAsync({ loaded: [], missing: [] });
		}

		const loadPromises = sessionIds.map((id) => {
			const session = this.stateReader.getSessionCold(id);
			if (!session) {
				return Promise.resolve({ id, success: false as const });
			}

			return api
				.getSessionOpenResult(id, session.projectPath, session.agentId, session.sourcePath)
				.andThen((openResult) => {
					if (openResult.outcome !== "found") {
						return okAsync({ id, success: false as const });
					}
					this.stateWriter.replaceSessionOpenSnapshot(openResult);
					const title = openResult.sessionTitle || undefined;
					if (title && title !== session.title) {
						this.stateWriter.updateSession(openResult.canonicalSessionId, { title });
					}
					return okAsync({ id: openResult.canonicalSessionId, success: true as const });
				})
				.match(
					(result) => result,
					() => ({ id, success: false as const })
				);
		});

		return ResultAsync.fromSafePromise(Promise.all(loadPromises)).map((results) => {
			const loaded: SessionCold[] = [];
			const missing: string[] = [];

			for (const result of results) {
				if (result.success) {
					const session = this.stateReader.getSessionCold(result.id);
					if (session) {
						loaded.push(session);
					}
				} else {
					missing.push(result.id);
				}
			}

			return { loaded, missing };
		});
	}

	/**
	 * Load a historical session from persisted provider history metadata.
	 */
	loadHistoricalSession(
		id: string,
		projectPath: string,
		title: string,
		agentId: string,
		sourcePath?: string,
		sequenceId?: number,
		parentId?: string | null,
		worktreePath?: string
	): ResultAsync<SessionCold, AppError> {
		logger.debug("Loading historical session", { id, projectPath, title, agentId });

		const existing = this.stateReader.getSessionCold(id);
		if (existing) {
			logger.debug("Historical session already loaded", { id });
			return okAsync(existing);
		}

		const now = new Date();
		const session: SessionCold = {
			id,
			projectPath,
			agentId,
			worktreePath,
			title,
			updatedAt: now,
			createdAt: now,
			sourcePath,
			sessionLifecycleState: "persisted",
			parentId: parentId ?? null,
			sequenceId,
		};

		this.stateWriter.addSession(session);
		logger.debug("Historical session loaded", { id, titleUsed: title });

		return okAsync(session);
	}

	// ============================================
	// PRIVATE HELPERS
	// ============================================

	/**
	 * Merge history entries with existing sessions.
	 */
	private mergeHistoryWithExisting(
		entries: HistoryEntry[],
		existingSessions: SessionCold[]
	): SessionCold[] {
		// Build map of existing sessions for O(1) lookup
		const existingSessionsMap = new Map(existingSessions.map((s) => [s.id, s]));

		// Convert history entries to sessions, merging with existing
		const mergedSessions: SessionCold[] = [];

		for (const entry of entries) {
			const historySession = this.historyEntryToSession(entry);
			const existingSession = existingSessionsMap.get(historySession.id);

			if (existingSession && this.entryManager.isPreloaded(existingSession.id)) {
				const title = resolveSessionTitle(historySession.title, existingSession.title);
				mergedSessions.push({
					...existingSession,
					// Propagate worktreePath from scan if the loading shell was created without it
					// (earlyPreloadPanelSessions doesn't have worktreePath in panel state).
					// Preserve any existing value; fall back to what the scan found.
					// Matches the pattern in refreshSessionsFromScan (line 194).
					sourcePath: historySession.sourcePath ?? existingSession.sourcePath,
					sessionLifecycleState:
						historySession.sessionLifecycleState ?? existingSession.sessionLifecycleState,
					parentId: historySession.parentId ?? existingSession.parentId,
					worktreePath: existingSession.worktreePath ?? historySession.worktreePath,
					prNumber: historySession.prNumber ?? existingSession.prNumber,
					sequenceId: existingSession.sequenceId ?? historySession.sequenceId,
					title,
					updatedAt: historySession.updatedAt,
				});
				existingSessionsMap.delete(historySession.id);
			} else if (existingSession) {
				const title = resolveSessionTitle(historySession.title, existingSession.title);
				// Session exists but not preloaded - use history metadata
				mergedSessions.push({
					...historySession,
					title,
				});
				existingSessionsMap.delete(historySession.id);
			} else {
				// New session from history
				mergedSessions.push(historySession);
			}
		}

		// Keep any existing sessions that weren't in the history results
		for (const existingSession of existingSessionsMap.values()) {
			mergedSessions.push(existingSession);
		}

		// Sort by updatedAt DESC
		mergedSessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

		return mergedSessions;
	}

	private reconcileAliasedStartupSessions(
		mergedSessions: SessionCold[],
		existingSessions: SessionCold[],
		aliasRemaps: Record<string, string>
	): SessionCold[] {
		const canonicalIds = new Set<string>();
		for (const canonicalId of Object.values(aliasRemaps)) {
			canonicalIds.add(canonicalId);
		}
		if (canonicalIds.size === 0) {
			return mergedSessions;
		}

		const canonicalSessionIds = new Set<string>();
		for (const session of mergedSessions) {
			canonicalSessionIds.add(session.id);
		}

		const aliasMetadataByCanonicalId = new Map<string, SessionCold>();
		const aliasIdsToDrop = new Set<string>();
		for (const [aliasId, canonicalId] of Object.entries(aliasRemaps)) {
			if (!canonicalSessionIds.has(canonicalId)) {
				continue;
			}

			const aliasSession = existingSessions.find((session) => session.id === aliasId);
			if (aliasSession !== undefined) {
				aliasMetadataByCanonicalId.set(canonicalId, aliasSession);
			}
			aliasIdsToDrop.add(aliasId);
		}

		const reconciledSessions: SessionCold[] = [];
		for (const session of mergedSessions) {
			const canonicalAliasSession = aliasMetadataByCanonicalId.get(session.id);
			if (canonicalAliasSession !== undefined) {
				const mergedPrNumber = session.prNumber ?? canonicalAliasSession.prNumber;
				const mergedPrLinkMode = normalizeSessionPrLinkMode(
					mergedPrNumber,
					session.prLinkMode ?? canonicalAliasSession.prLinkMode
				);

				reconciledSessions.push({
					id: session.id,
					projectPath: session.projectPath,
					agentId: session.agentId,
					worktreePath: session.worktreePath ?? canonicalAliasSession.worktreePath,
					title: session.title,
					createdAt: session.createdAt,
					updatedAt: session.updatedAt,
					sourcePath: session.sourcePath ?? canonicalAliasSession.sourcePath,
					sessionLifecycleState:
						session.sessionLifecycleState ?? canonicalAliasSession.sessionLifecycleState,
					parentId: session.parentId,
					prNumber: mergedPrNumber,
					prState: session.prState ?? canonicalAliasSession.prState,
					prLinkMode: mergedPrLinkMode,
					linkedPr: session.linkedPr ?? canonicalAliasSession.linkedPr,
					worktreeDeleted: session.worktreeDeleted ?? canonicalAliasSession.worktreeDeleted,
					sequenceId: session.sequenceId ?? canonicalAliasSession.sequenceId,
				});
				continue;
			}

			if (canonicalIds.has(session.id)) {
				reconciledSessions.push(session);
				continue;
			}

			if (aliasIdsToDrop.has(session.id)) {
				continue;
			}

			reconciledSessions.push(session);
		}

		return reconciledSessions;
	}

	/**
	 * Deduplicate entries by sessionId (keep the one with latest updatedAt).
	 */
	private deduplicateEntries(entries: HistoryEntry[]): HistoryEntry[] {
		const entriesBySessionId = new Map<string, HistoryEntry>();
		for (const entry of entries) {
			const existing = entriesBySessionId.get(entry.sessionId);
			if (existing === undefined || entry.updatedAt > existing.updatedAt) {
				entriesBySessionId.set(entry.sessionId, entry);
			}
		}

		const deduplicated = Array.from(entriesBySessionId.values());
		if (deduplicated.length < entries.length) {
			logger.debug("Deduplicated scan entries", {
				original: entries.length,
				deduplicated: deduplicated.length,
			});
		}
		return deduplicated;
	}

	/**
	 * Convert HistoryEntry to Session format.
	 */
	private historyEntryToSession(entry: HistoryEntry): SessionCold {
		const agentId = typeof entry.agentId === "string" ? entry.agentId : entry.agentId.custom;

		return {
			id: entry.sessionId,
			projectPath: entry.project,
			agentId,
			title: entry.display,
			updatedAt: new Date(entry.updatedAt),
			createdAt: new Date(entry.timestamp),
			sourcePath: entry.sourcePath === null ? undefined : entry.sourcePath,
			sessionLifecycleState:
				entry.sessionLifecycleState === null ? undefined : entry.sessionLifecycleState,
			parentId: entry.parentId ?? null,
			worktreePath: entry.worktreePath === null ? undefined : entry.worktreePath,
			worktreeDeleted: entry.worktreeDeleted === null ? undefined : entry.worktreeDeleted,
			prNumber: entry.prNumber === null ? undefined : entry.prNumber,
			prLinkMode: normalizeSessionPrLinkMode(entry.prNumber, entry.prLinkMode),
			linkedPr:
				entry.prNumber === null || entry.prNumber === undefined
					? undefined
					: buildPartialSessionLinkedPr(
							entry.prNumber,
							undefined
						),
			sequenceId: entry.sequenceId === null ? undefined : entry.sequenceId,
		};
	}
}

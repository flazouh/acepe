/**
 * SessionListState — the session-list slice of the session store, extracted as a
 * composed sub-store (see docs/adr/0002). Owns the cold session list, its by-id /
 * by-project indexes, the live-sync + palette reference arrays, and the
 * per-project scanning flags. Pure list/index state — disjoint from the
 * per-session canonical projection. The parent `SessionStore` holds one instance
 * and delegates its list-domain reads/writes here. GOD-safe: this slice is
 * derived list/index data, never canonical session-graph truth.
 */
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { sessionColdFromSlices } from "../application/dto/session-cold.js";
import type { SessionPrLinkReference } from "../application/dto/session-linked-pr.js";
import { createLogger } from "../utils/logger.js";
import {
	createPatchedReferenceArray,
	createPatchedSessionColdArray,
	createPrependedReferenceArray,
	createPrependedSessionColdArray,
	findSessionColdIndexById,
	patchSessionIdsByProjectIndex,
	patchSessionsByProjectIndex,
	rebuildLiveSessionSyncReferences,
	rebuildSessionByIdIndex,
	rebuildSessionIdsByProjectIndex,
	rebuildSessionPaletteReferences,
	rebuildSessionsByProjectIndex,
	type SessionLiveSyncReference,
	type SessionPaletteReference,
	sessionColdFromExistingSession,
	sessionColdWithMutableUpdates,
	sessionLiveSyncReferenceFromSession,
	sessionPaletteReferenceFromSession,
} from "./session-cold-index.js";
import type { SessionEntryStore } from "./session-entry-store.svelte.js";
import type {
	SessionCold,
	SessionIdentity,
	SessionMetadata,
	SessionMutableColdUpdates,
} from "./types.js";

const logger = createLogger({ id: "session-list-state", name: "SessionListState" });

// QA-only write timeline: every wholesale sessions replacement is recorded on
// window so an outside QA driver can see WHO last rewrote the list and when.
// The failure mode this exists for: a later writer stomping a successful
// scan's result, which is invisible from the DOM (both states just render).
// Gated at read time by the hook consumer; recording is a bounded ring.
const QA_WRITE_LOG_LIMIT = 60;
const QA_WRITE_LOG_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_HOOKS === "1";
function recordSessionListWriteForQa(count: number, tag: string): void {
	if (!QA_WRITE_LOG_ENABLED || typeof window === "undefined") {
		return;
	}
	const qaWindow = window as {
		__acepeQaSessionListWrites?: Array<{ atMs: number; count: number; tag: string; stack: string }>;
	};
	const writes = qaWindow.__acepeQaSessionListWrites ?? [];
	if (writes.length >= QA_WRITE_LOG_LIMIT) {
		return;
	}
	writes.push({
		atMs: Math.round(performance.now()),
		count,
		tag,
		stack: new Error("trace").stack?.split("\n").slice(2, 12).join(" | ") ?? "",
	});
	qaWindow.__acepeQaSessionListWrites = writes;
}

export type SessionListStateReadDeps = {
	readonly entryStore: SessionEntryStore;
	readonly hasSessionCanonicalProjection: (sessionId: string) => boolean;
};

export class SessionListState {
	sessions = $state<SessionCold[]>([]);
	readonly sessionById = new SvelteMap<string, SessionCold>();
	readonly sessionsByProject = new SvelteMap<string, SessionCold[]>();
	readonly sessionIdsByProject = new SvelteMap<string, string[]>();
	liveSessionSyncReferences = $state<SessionLiveSyncReference[]>([]);
	sessionPaletteReferences = $state<SessionPaletteReference[]>([]);

	/** Project paths currently being scanned for sessions (for per-project skeleton display). */
	readonly scanningProjectPaths = new SvelteSet<string>();

	#readDeps: SessionListStateReadDeps | null = null;

	configureReadDeps(deps: SessionListStateReadDeps): void {
		this.#readDeps = deps;
	}

	getAllSessions(): SessionCold[] {
		const sessions: SessionCold[] = [];
		for (const session of this.sessions) {
			sessions.push(sessionColdFromExistingSession(session));
		}
		return sessions;
	}

	getSessionIdentity(sessionId: string): SessionIdentity | undefined {
		const session = this.sessionById.get(sessionId);
		if (!session) {
			return undefined;
		}
		return {
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			worktreePath: session.worktreePath,
		};
	}

	hasSession(sessionId: string): boolean {
		return this.sessionById.has(sessionId);
	}

	getSessionMetadata(sessionId: string): SessionMetadata | undefined {
		const session = this.sessionById.get(sessionId);
		if (!session) {
			return undefined;
		}
		return {
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			sourcePath: session.sourcePath,
			sessionLifecycleState: session.sessionLifecycleState,
			parentId: session.parentId,
			// Every field of the slice, deliberately: getSessionCold rebuilds a
			// whole row out of this copy, so a field left out here is reported
			// as absent by a method whose type promises it. archivedAt was
			// missing, and every archived session read back as active.
			archivedAt: session.archivedAt,
			prNumber: session.prNumber,
			prState: session.prState,
			prLinkMode: session.prLinkMode,
			linkedPr: session.linkedPr,
			worktreeDeleted: session.worktreeDeleted,
			sequenceId: session.sequenceId,
			usageStats: session.usageStats,
		};
	}

	getSessionCold(sessionId: string): SessionCold | undefined {
		const sessionIdentity = this.getSessionIdentity(sessionId);
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionIdentity || !sessionMetadata) {
			return undefined;
		}

		return sessionColdFromSlices(sessionIdentity, sessionMetadata);
	}

	getSessionIdsForProject(projectPath: string): string[] {
		return this.sessionIdsByProject.get(projectPath) ?? [];
	}

	getLiveSessionSyncReferences(): SessionLiveSyncReference[] {
		return this.liveSessionSyncReferences;
	}

	getSessionPaletteReferences(): SessionPaletteReference[] {
		return this.sessionPaletteReferences;
	}

	getSessionPaletteReference(sessionId: string): SessionPaletteReference | undefined {
		const session = this.sessionById.get(sessionId);
		if (!session) {
			return undefined;
		}
		return {
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			title: session.title,
		};
	}

	getSessionPrLinkReferencesForProject(projectPath: string): SessionPrLinkReference[] {
		const sessions = this.sessionsByProject.get(projectPath) ?? [];
		const references: SessionPrLinkReference[] = [];
		for (const session of sessions) {
			if (session.prNumber == null) {
				continue;
			}
			references.push({
				id: session.id,
				prNumber: session.prNumber,
				sequenceId: session.sequenceId ?? undefined,
			});
		}
		return references;
	}

	getSessionDetail(sessionId: string): SessionCold | null {
		const readDeps = this.#readDeps;
		if (readDeps === null) {
			return null;
		}

		const sessionIdentity = this.getSessionIdentity(sessionId);
		const sessionMetadata = this.getSessionMetadata(sessionId);
		if (!sessionIdentity || !sessionMetadata) {
			return null;
		}
		if (
			sessionMetadata.sessionLifecycleState !== "created" &&
			!readDeps.hasSessionCanonicalProjection(sessionId) &&
			!readDeps.entryStore.isPreloaded(sessionId)
		) {
			return null;
		}
		return sessionColdFromSlices(sessionIdentity, sessionMetadata);
	}

	/** Set sessions array (for bulk operations). */
	setSessions(sessions: SessionCold[], qaWriterTag?: string): void {
		recordSessionListWriteForQa(sessions.length, qaWriterTag ?? "untagged");
		this.sessions = sessions;
		rebuildSessionByIdIndex(this.sessionById, sessions);
		rebuildSessionsByProjectIndex(this.sessionsByProject, sessions);
		rebuildSessionIdsByProjectIndex(this.sessionIdsByProject, sessions);
		this.liveSessionSyncReferences = rebuildLiveSessionSyncReferences(sessions);
		this.sessionPaletteReferences = rebuildSessionPaletteReferences(sessions);
	}

	/** Add a session to the list (prepend). */
	addSession(session: SessionCold): void {
		this.sessions = createPrependedSessionColdArray(session, this.sessions);
		this.sessionById.set(session.id, session);
		patchSessionsByProjectIndex(this.sessionsByProject, undefined, session);
		patchSessionIdsByProjectIndex(this.sessionIdsByProject, undefined, session);
		this.liveSessionSyncReferences = createPrependedReferenceArray(
			sessionLiveSyncReferenceFromSession(session),
			this.liveSessionSyncReferences
		);
		this.sessionPaletteReferences = createPrependedReferenceArray(
			sessionPaletteReferenceFromSession(session),
			this.sessionPaletteReferences
		);
		logger.debug("Added session", { sessionId: session.id });
	}

	/** Update a session's cold data by ID (creates new array for reactivity). */
	updateSession(
		id: string,
		updates: SessionMutableColdUpdates,
		options?: { touchUpdatedAt?: boolean }
	): void {
		const sessionIndex = findSessionColdIndexById(this.sessions, id);
		if (sessionIndex === -1) {
			return;
		}

		const session = this.sessions[sessionIndex];
		if (session === undefined) {
			return;
		}

		const updatedAt =
			updates.updatedAt !== undefined
				? updates.updatedAt
				: options?.touchUpdatedAt === false
					? session.updatedAt
					: new Date();

		const updatedSession = sessionColdWithMutableUpdates(session, updates, updatedAt);
		this.sessions = createPatchedSessionColdArray(this.sessions, sessionIndex, updatedSession);
		this.sessionById.set(id, updatedSession);
		patchSessionsByProjectIndex(this.sessionsByProject, session, updatedSession);
		patchSessionIdsByProjectIndex(this.sessionIdsByProject, session, updatedSession);
		this.liveSessionSyncReferences = createPatchedReferenceArray(
			this.liveSessionSyncReferences,
			sessionLiveSyncReferenceFromSession(updatedSession)
		);
		this.sessionPaletteReferences = createPatchedReferenceArray(
			this.sessionPaletteReferences,
			sessionPaletteReferenceFromSession(updatedSession)
		);
	}

	/**
	 * Apply an open-snapshot replacement to the list when the canonical session
	 * already exists. `previousSession` is the prior cold (for project-index
	 * diffing); `snapshotSession` is the replacement.
	 */
	applyOpenSnapshotToList(previousSession: SessionCold, snapshotSession: SessionCold): void {
		const sessionIndex = findSessionColdIndexById(this.sessions, snapshotSession.id);
		this.sessions =
			sessionIndex === -1
				? createPrependedSessionColdArray(snapshotSession, this.sessions)
				: createPatchedSessionColdArray(this.sessions, sessionIndex, snapshotSession);
		this.sessionById.set(snapshotSession.id, snapshotSession);
		patchSessionsByProjectIndex(this.sessionsByProject, previousSession, snapshotSession);
		patchSessionIdsByProjectIndex(this.sessionIdsByProject, previousSession, snapshotSession);
		this.liveSessionSyncReferences = createPatchedReferenceArray(
			this.liveSessionSyncReferences,
			sessionLiveSyncReferenceFromSession(snapshotSession)
		);
		this.sessionPaletteReferences = createPatchedReferenceArray(
			this.sessionPaletteReferences,
			sessionPaletteReferenceFromSession(snapshotSession)
		);
	}

	/** Mark project paths as currently being scanned. */
	addScanningProjects(paths: string[]): void {
		for (const p of paths) {
			this.scanningProjectPaths.add(p);
		}
	}

	/** Clear scanning state for project paths. */
	removeScanningProjects(paths: string[]): void {
		for (const p of paths) {
			this.scanningProjectPaths.delete(p);
		}
	}
}

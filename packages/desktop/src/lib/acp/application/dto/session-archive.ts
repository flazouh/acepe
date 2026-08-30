import type { SessionCold } from "./session-cold.js";

/**
 * Archived-ness is canonical session truth.
 *
 * The fact lives on the orchestration session row (`archived_at`, written by
 * the SessionArchived event), reaches the app through the library projection
 * (see mergeProjectionSessions), and rides SessionCold as `archivedAt`. There
 * is deliberately no client-side hide list beside it: a second store of the
 * same fact would drift from the backend and would leave the provider process
 * running while the row looked archived.
 */
export type ArchivableSession = Pick<SessionCold, "archivedAt">;

export function isSessionArchived(session: ArchivableSession): boolean {
	return (session.archivedAt ?? null) !== null;
}

/** Sessions the sidebar shows: everything the backend has not archived. */
export function selectActiveSessions<Session extends ArchivableSession>(
	sessions: readonly Session[]
): Session[] {
	return sessions.filter((session) => !isSessionArchived(session));
}

/** Sessions the settings archive list shows. */
export function selectArchivedSessions<Session extends ArchivableSession>(
	sessions: readonly Session[]
): Session[] {
	return sessions.filter((session) => isSessionArchived(session));
}

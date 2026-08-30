/**
 * Pure merge logic backing SessionRepository.scanSessionProjections (see
 * that method's doc comment for the "why"). Extracted so the merge/dedupe
 * rules are directly testable without standing up the full repository or
 * mocking the RPC layer.
 */
import type { RpcProjectedProject, RpcProjectedSession } from "@acepe/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import {
	buildPartialSessionLinkedPr,
	type SessionPrLinkMode,
} from "../../application/dto/session-linked-pr.js";
import type { SessionCold } from "../types.js";

// RpcProjectedSession's timestamps are the canonical IsoDateTime schema
// (packages/contracts/src/baseSchemas.ts), always a valid ISO string --
// this only ever throws on a schema-boundary bug upstream, not on real
// server data.
export const isoToDate = (iso: string): Date =>
	DateTime.toDate(
		Option.getOrThrowWith(
			DateTime.make(iso),
			() => new Error(`mergeProjectionSessions: invalid ISO date '${iso}'`)
		)
	);

// One malformed row (a schema-boundary bug upstream, per isoToDate's
// contract) must drop only that row, not the whole snapshot: mixing one bad
// session into a library snapshot alongside dozens of good ones must not
// blank every project's projection-only sessions just because isoToDate
// throws partway through the loop below.
export const tryIsoToDate = (iso: string): Date | null => {
	try {
		return isoToDate(iso);
	} catch {
		return null;
	}
};

function normalizeProjectionPrLinkMode(
	prNumber: number | null | undefined,
	prLinkMode: string | null | undefined
): SessionPrLinkMode | undefined {
	if (prLinkMode === "automatic" || prLinkMode === "manual") {
		return prLinkMode;
	}
	return prNumber == null ? undefined : "automatic";
}

/**
 * Dedupe by sessionId: an existing entry (from disk scan or an earlier
 * optimistic insert) wins on every field except title, which the
 * projection row only overrides when it is strictly newer (updatedAt). A
 * new projection-only session is added with sessionLifecycleState
 * "created" (the same transient marker registerSessionPlaceholder uses),
 * so a later scanSessions rescan of its project never prunes it away --
 * see refreshSessionsFromScan's preserveTransientSession check. Every row
 * carries the canonical `archivedAt` onto the merged session, including onto
 * a session the disk scan already found; the sidebar filters on that field.
 * Skips deleted projection rows and rows with no resolvable provider or
 * project path -- there is no canonical fact to display. Also skips a row
 * with an unparseable timestamp (see tryIsoToDate) rather than throwing --
 * one malformed session must not blank every project's projection-only
 * sessions for the whole snapshot.
 */
export function mergeProjectionSessions(
	existingSessions: readonly SessionCold[],
	projectedSessions: readonly RpcProjectedSession[],
	projects: readonly RpcProjectedProject[]
): SessionCold[] {
	const workspaceRootByProjectId = new Map(
		projects.map((project) => [project.projectId, project.workspaceRoot])
	);
	const existingSessionsMap = new Map(existingSessions.map((session) => [session.id, session]));
	const merged = [...existingSessions];

	for (const projected of projectedSessions) {
		if (projected.deletedAt !== null) {
			continue;
		}
		if (projected.provider === null) {
			continue;
		}
		// Archived is a canonical fact carried on the row, never a reason to
		// drop it here: the disk scan runs right after this union and would
		// re-add the same session with no archivedAt, so an archived session
		// would come back on every restart. The sidebar filters on archivedAt
		// (selectActiveSessions) and the settings archive list reads the same
		// field, so both surfaces agree with the backend.
		const archivedAt = projected.archivedAt === null ? null : tryIsoToDate(projected.archivedAt);
		const projectPath = workspaceRootByProjectId.get(projected.projectId);
		if (projectPath === undefined) {
			continue;
		}

		const existing = existingSessionsMap.get(projected.sessionId);
		if (existing !== undefined) {
			const index = merged.findIndex((session) => session.id === existing.id);
			if (index === -1) {
				continue;
			}
			const projectedUpdatedAt = tryIsoToDate(projected.updatedAt);
			// Title only wins when the projection row is strictly newer;
			// archivedAt always wins, because the row is its only source.
			const titleWins =
				projectedUpdatedAt !== null && projectedUpdatedAt.getTime() > existing.updatedAt.getTime();
			merged[index] = {
				...existing,
				title: titleWins ? projected.title : existing.title,
				updatedAt: titleWins ? projectedUpdatedAt : existing.updatedAt,
				archivedAt,
			};
			continue;
		}

		// The orchestration session id (projected.sessionId) and the
		// provider's own on-disk session id (projected.providerSessionId)
		// are two permanent ids for the SAME session -- see
		// RpcProjectedSession's providerSessionId doc. When a disk-scanned
		// row already exists under the provider id, this projection row is
		// not a second session: it is that same session's orchestration-side
		// metadata (title, PR link) arriving late. Merge into the
		// disk-scanned row (the openable identity that can actually render
		// full history) instead of pushing a duplicate sidebar entry keyed
		// by the orchestration id -- this is the fix for the duplicate
		// sidebar row bug (#262).
		const aliasedExisting =
			projected.providerSessionId !== null
				? existingSessionsMap.get(projected.providerSessionId)
				: undefined;
		if (aliasedExisting !== undefined) {
			const index = merged.findIndex((session) => session.id === aliasedExisting.id);
			if (index !== -1) {
				const projectedUpdatedAt = tryIsoToDate(projected.updatedAt);
				const titleWins =
					projectedUpdatedAt !== null &&
					projectedUpdatedAt.getTime() > aliasedExisting.updatedAt.getTime();
				const mergedPrNumber = projected.prNumber ?? aliasedExisting.prNumber;
				const mergedPrLinkMode =
					normalizeProjectionPrLinkMode(projected.prNumber, projected.prLinkMode) ??
					aliasedExisting.prLinkMode;
				merged[index] = {
					...aliasedExisting,
					title: titleWins ? projected.title : aliasedExisting.title,
					updatedAt: titleWins ? projectedUpdatedAt : aliasedExisting.updatedAt,
					archivedAt,
					prNumber: mergedPrNumber,
					prLinkMode: mergedPrLinkMode,
					linkedPr:
						projected.prNumber === null ||
						projected.prNumber === undefined ||
						aliasedExisting.linkedPr?.prNumber === projected.prNumber
							? aliasedExisting.linkedPr
							: buildPartialSessionLinkedPr(projected.prNumber, undefined),
				};
			}
			continue;
		}

		// A session whose provider adapter died (ProviderSessionFailed) before
		// it ever learned a providerSessionId has no on-disk history to fall
		// back to -- there is no path that will ever make this row openable.
		// Excluding it here (rather than pushing it) is the fix for the
		// "ghost row" sitting in the sidebar forever, unopenable (#262). A
		// session that failed AFTER learning its providerSessionId is not a
		// ghost -- it would have matched the aliasedExisting/existing branches
		// above and never reach here.
		if (projected.providerSessionFailed) {
			continue;
		}

		const createdAt = tryIsoToDate(projected.createdAt);
		const updatedAt = tryIsoToDate(projected.updatedAt);
		if (createdAt === null || updatedAt === null) {
			continue;
		}

		merged.push({
			id: projected.sessionId,
			projectPath,
			agentId: projected.provider,
			title: projected.title,
			createdAt,
			updatedAt,
			sessionLifecycleState: "created",
			parentId: null,
			archivedAt,
			prNumber: projected.prNumber ?? undefined,
			prLinkMode: normalizeProjectionPrLinkMode(projected.prNumber, projected.prLinkMode),
			linkedPr:
				projected.prNumber === null || projected.prNumber === undefined
					? undefined
					: buildPartialSessionLinkedPr(projected.prNumber, undefined),
		});
	}

	return merged;
}

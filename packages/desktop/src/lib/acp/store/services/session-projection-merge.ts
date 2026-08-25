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
 * see refreshSessionsFromScan's preserveTransientSession check. Skips
 * archived/deleted projection rows and rows with no resolvable provider or
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
		if (projected.deletedAt !== null || projected.archivedAt !== null) {
			continue;
		}
		if (projected.provider === null) {
			continue;
		}
		const projectPath = workspaceRootByProjectId.get(projected.projectId);
		if (projectPath === undefined) {
			continue;
		}

		const existing = existingSessionsMap.get(projected.sessionId);
		if (existing !== undefined) {
			const projectedUpdatedAt = tryIsoToDate(projected.updatedAt);
			if (projectedUpdatedAt === null) {
				continue;
			}
			if (projectedUpdatedAt.getTime() > existing.updatedAt.getTime()) {
				const index = merged.findIndex((session) => session.id === existing.id);
				if (index !== -1) {
					merged[index] = {
						...existing,
						title: projected.title,
						updatedAt: projectedUpdatedAt,
					};
				}
			}
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

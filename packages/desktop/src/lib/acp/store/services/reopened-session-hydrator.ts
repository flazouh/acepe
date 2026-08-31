/**
 * Reopen-session transcript hydration -- the impure half of
 * reopen-snapshot-graph.ts's pure `graphFromReopenSnapshot`. Fetches the
 * `{sessionId}` contract snapshot (importing an on-disk-only,
 * never-imported-this-run session first, idempotently, when needed), builds
 * the canonical graph, and applies it through the exact same
 * `applySessionStateEnvelope` -> `routeSessionStateEnvelope` ->
 * `reduceCommand`'s `reduceReplaceGraph` path live orchestration deltas
 * already use -- so its `isNewerGraphRevision` guard is what protects a live
 * session's graph from being stomped by a late-resolving hydration.
 *
 * Called from open-persisted-session.ts's `getSessionOpenResult` failure
 * path: that RPC is unsupportedOnContract under Electrobun today (see
 * backend-client/history.ts's header comment), so nothing else seeds
 * transcriptSnapshot.entries for a session this app run did not itself
 * create.
 */
import type { RpcSessionSnapshot } from "@acepe/contracts";
import * as Effect from "effect/Effect";

import type { SessionGraphRevision, SessionStateEnvelope } from "../../../services/acp-types.js";
import type { AppError } from "../../errors/app-error.js";
import { realignCanonicalSession } from "../../logic/acp-event-bridge.js";
import {
	graphFromReopenSnapshot,
	reopenGraphRevisionForApply,
} from "../../logic/reopen-snapshot-graph.js";
import { createSnapshotEnvelope } from "../../session-state/session-state-protocol.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger({
	id: "reopened-session-hydrator",
	name: "ReopenedSessionHydrator",
});

export interface ReopenedSessionHydrationInput {
	readonly sessionId: string;
	readonly agentId: string;
	readonly projectPath: string;
	readonly worktreePath: string | null;
	readonly sourcePath: string | null;
	readonly sequenceId: number | null;
}

export interface ReopenedSessionHydrationResult {
	readonly applied: boolean;
	/**
	 * Present only when the requested id resolved to a DIFFERENT aggregate:
	 * the requested id was a provider's on-disk session uuid that a live
	 * session claims via provider_session_id (the #262 alias display
	 * identity). The graph was applied under this id; the caller must rebind
	 * its panel to it, exactly like session-open-hydrator's found path does
	 * with SessionOpenFound.canonicalSessionId.
	 */
	readonly canonicalSessionId?: string;
}

export interface EnsureProviderSessionImportedResult {
	/**
	 * The aggregate id the provider session resolved to, or null when
	 * discovery found no such provider session (nothing to import, nothing
	 * claimed). Equal to the requested id for a plain import; different when
	 * a live session already claims the uuid via provider_session_id.
	 */
	readonly resolvedSessionId: string | null;
}

export interface ReopenedSessionHydratorDeps {
	readonly getSessionSnapshot: (sessionId: string) => Effect.Effect<RpcSessionSnapshot, AppError>;
	readonly ensureProviderSessionImported: (
		sessionId: string
	) => Effect.Effect<EnsureProviderSessionImportedResult, AppError>;
	readonly applySessionStateEnvelope: (sessionId: string, envelope: SessionStateEnvelope) => void;
	/**
	 * The local graph's current revision, if one already exists (e.g. from an
	 * earlier reopen, or from live deltas), or `null` for a from-empty
	 * hydration. Feeds `reopenGraphRevisionForApply` -- see that function's
	 * doc comment (AC-263 issue #263 defect 2) for why this hydrator must
	 * consult it instead of unconditionally applying every fetched snapshot.
	 */
	readonly getCurrentGraphRevision: (sessionId: string) => SessionGraphRevision | null;
}

function snapshotIsNotYetImported(snapshot: RpcSessionSnapshot): boolean {
	return snapshot.session === null;
}

interface ResolvedSnapshot {
	readonly snapshot: RpcSessionSnapshot;
	/** The aggregate the snapshot belongs to (differs from the requested id on alias). */
	readonly resolvedSessionId: string;
}

/**
 * Best-effort import-then-re-fetch. The import step doubles as identity
 * resolution: a requested id that is really a provider's on-disk uuid
 * claimed by a live session (provider_session_id) resolves to that claiming
 * aggregate instead of importing a twin, and the re-fetch follows the
 * resolved id so the snapshot carries the claiming aggregate's canonical
 * facts (still-pending approvals included). A failed import (e.g. the
 * session was never actually on disk, or discovery raced with a deletion)
 * falls back to the pre-import snapshot rather than failing hydration
 * outright -- an empty/"reserved" graph is an honest, harmless result.
 */
function snapshotAfterEnsuringImported(
	deps: ReopenedSessionHydratorDeps,
	sessionId: string,
	initialSnapshot: RpcSessionSnapshot
): Effect.Effect<ResolvedSnapshot, never> {
	return deps.ensureProviderSessionImported(sessionId).pipe(
		Effect.flatMap((imported) => {
			const resolvedSessionId = imported.resolvedSessionId ?? sessionId;
			return deps
				.getSessionSnapshot(resolvedSessionId)
				.pipe(Effect.map((snapshot) => ({ snapshot, resolvedSessionId })));
		}),
		Effect.catch((error) => {
			logger.warn("Import-on-open failed; hydrating from the pre-import snapshot", {
				sessionId,
				error,
			});
			return Effect.succeed({ snapshot: initialSnapshot, resolvedSessionId: sessionId });
		})
	);
}

export function hydrateReopenedSessionSnapshot(
	input: ReopenedSessionHydrationInput,
	deps: ReopenedSessionHydratorDeps
): Effect.Effect<ReopenedSessionHydrationResult, never> {
	return deps.getSessionSnapshot(input.sessionId).pipe(
		Effect.flatMap((initialSnapshot): Effect.Effect<ResolvedSnapshot, AppError> => {
			const isOnDiskOnly = snapshotIsNotYetImported(initialSnapshot) && input.sourcePath !== null;
			return isOnDiskOnly
				? snapshotAfterEnsuringImported(deps, input.sessionId, initialSnapshot)
				: Effect.succeed({ snapshot: initialSnapshot, resolvedSessionId: input.sessionId });
		}),
		Effect.map(({ snapshot, resolvedSessionId }) => {
			const isAlias = resolvedSessionId !== input.sessionId;
			const graph = graphFromReopenSnapshot({
				requestedSessionId: input.sessionId,
				canonicalSessionId: resolvedSessionId,
				agentId: input.agentId,
				projectPath: input.projectPath,
				worktreePath: input.worktreePath,
				sourcePath: input.sourcePath,
				sequenceId: input.sequenceId,
				snapshot,
			});
			const currentRevision = deps.getCurrentGraphRevision(resolvedSessionId);
			const revisionForApply = reopenGraphRevisionForApply(graph, currentRevision);
			if (revisionForApply === null) {
				return isAlias
					? { applied: false, canonicalSessionId: resolvedSessionId }
					: { applied: false };
			}
			const graphForApply = { ...graph, revision: revisionForApply };
			deps.applySessionStateEnvelope(resolvedSessionId, createSnapshotEnvelope(graphForApply));
			// The live bridge counts this session's revisions from zero and has no
			// way to learn that a reopen just moved it to the snapshot's
			// server-sequence revision. Without this every event after a reopen
			// arrives at a revision the client has already passed, the router
			// reads a frontier mismatch, and the session stops applying anything
			// while the server keeps committing tool calls and approvals.
			realignCanonicalSession(resolvedSessionId, revisionForApply);
			return isAlias
				? { applied: true, canonicalSessionId: resolvedSessionId }
				: { applied: true };
		}),
		Effect.catch((error) => {
			logger.warn("Reopen-session snapshot hydration failed", {
				sessionId: input.sessionId,
				error,
			});
			return Effect.succeed({ applied: false });
		})
	);
}

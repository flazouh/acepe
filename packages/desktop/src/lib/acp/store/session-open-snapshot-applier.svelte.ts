/**
 * SessionOpenSnapshotApplier — owns open-snapshot hydration and graph-driven
 * session materialization for the session store (see docs/adr/0002).
 *
 * Applies Rust-authored SessionOpenFound payloads into cold list state, entry/
 * operation stores, and canonical projection maps without duplicating envelope
 * reducer logic.
 */
import type { SessionOpenFound, SessionStateGraph } from "../../services/acp-types.js";
import { materializeSnapshotFromOpenFound } from "../session-state/session-state-protocol.js";
import { sessionColdFromSlices } from "../application/dto/session-cold.js";
import { canonicalAgentIdToString } from "../types/agent-id.js";
import { sanitizeCanonicalCapabilities } from "./canonical-config-sanitize.js";
import { deriveCapabilityPreviewState } from "./capability-projection.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import { preserveCanonicalStreamingState } from "./envelope-reducer/canonical-streaming-state.js";
import { mapProjectionTurnFailure } from "./envelope-reducer/projection-turn-failure.js";
import { seedTranscriptEntryIndex } from "./transcript-entry-index.js";
import type { SessionCreationCoordinator } from "./session-creation-coordinator.svelte.js";
import type { SessionListState } from "./session-list-state.svelte.js";
import type {
	SessionCold,
	SessionIdentity,
	SessionMetadata,
	SessionMutableColdUpdates,
	SessionTransientProjection,
} from "./types.js";

function sessionColdFromOpenSnapshotInput(input: {
	readonly id: string;
	readonly projectPath: string;
	readonly agentId: string;
	readonly worktreePath?: string;
	readonly title: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly sourcePath?: string;
	readonly sessionLifecycleState: SessionMetadata["sessionLifecycleState"];
	readonly parentId: string | null;
	readonly sequenceId: number | null;
	readonly preservedMetadata?: SessionMetadata;
}): SessionCold {
	return sessionColdFromSlices(
		{
			id: input.id,
			projectPath: input.projectPath,
			agentId: input.agentId,
			worktreePath: input.worktreePath,
		},
		{
			title: input.title,
			createdAt: input.createdAt,
			updatedAt: input.updatedAt,
			sourcePath: input.sourcePath,
			sessionLifecycleState: input.sessionLifecycleState,
			parentId: input.parentId,
			prNumber: input.preservedMetadata?.prNumber,
			prState: input.preservedMetadata?.prState,
			prLinkMode: input.preservedMetadata?.prLinkMode,
			linkedPr: input.preservedMetadata?.linkedPr,
			worktreeDeleted: input.preservedMetadata?.worktreeDeleted,
			sequenceId: input.sequenceId ?? input.preservedMetadata?.sequenceId,
		}
	);
}

export type SessionOpenSnapshotApplierDeps = {
	readonly listState: SessionListState;
	readonly creationCoordinator: SessionCreationCoordinator;
	readonly getSessionIdentity: (sessionId: string) => SessionIdentity | undefined;
	readonly getSessionMetadata: (sessionId: string) => SessionMetadata | undefined;
	readonly addSession: (session: SessionCold) => void;
	readonly removeSession: (sessionId: string) => void;
	readonly updateSession: (
		id: string,
		updates: SessionMutableColdUpdates,
		options?: { touchUpdatedAt?: boolean }
	) => void;
	readonly replaceSessionOperations: (
		sessionId: string,
		operations: SessionOpenFound["operations"]
	) => void;
	readonly replaceTranscriptSnapshot: (
		sessionId: string,
		snapshot: SessionOpenFound["transcriptSnapshot"],
		appliedAt: Date
	) => void;
	readonly initializeTransientProjection: (sessionId: string) => void;
	readonly updateTransientProjection: (
		sessionId: string,
		updates: {
			statusChangedAt?: number;
			capabilityMutationState?: SessionTransientProjection["capabilityMutationState"];
		}
	) => void;
	readonly setSessionStateGraph: (sessionId: string, graph: SessionStateGraph) => void;
	readonly setCanonicalProjection: (
		sessionId: string,
		projection: CanonicalSessionProjection
	) => void;
	readonly setCapabilitiesMaterialized: (sessionId: string, materialized: boolean) => void;
	readonly getCanonicalProjection: (sessionId: string) => CanonicalSessionProjection | null;
	readonly sendContentLoad: (sessionId: string) => void;
	readonly sendContentLoaded: (sessionId: string) => void;
	readonly recordAliasRelationship: (
		requestedSessionId: string,
		canonicalSessionId: string
	) => void;
	readonly migratePendingSendIntentAlias: (
		requestedSessionId: string,
		canonicalSessionId: string
	) => void;
};

export class SessionOpenSnapshotApplier {
	readonly #deps: SessionOpenSnapshotApplierDeps;

	constructor(deps: SessionOpenSnapshotApplierDeps) {
		this.#deps = deps;
	}

	replaceSessionOpenSnapshot(snapshot: SessionOpenFound): void {
		const canonicalSessionId = snapshot.canonicalSessionId;
		const requestedSessionId = snapshot.requestedSessionId;
		if (snapshot.isAlias && requestedSessionId !== canonicalSessionId) {
			this.#deps.recordAliasRelationship(requestedSessionId, canonicalSessionId);
			this.#deps.migratePendingSendIntentAlias(requestedSessionId, canonicalSessionId);
		}
		const aliasSessionIdentity =
			snapshot.isAlias && requestedSessionId !== canonicalSessionId
				? this.#deps.getSessionIdentity(requestedSessionId)
				: undefined;
		const aliasSessionMetadata =
			snapshot.isAlias && requestedSessionId !== canonicalSessionId
				? this.#deps.getSessionMetadata(requestedSessionId)
				: undefined;
		const aliasSession =
			aliasSessionIdentity && aliasSessionMetadata
				? sessionColdFromSlices(aliasSessionIdentity, aliasSessionMetadata)
				: undefined;
		const canonicalSessionIdentity = this.#deps.getSessionIdentity(canonicalSessionId);
		const canonicalSessionMetadata = this.#deps.getSessionMetadata(canonicalSessionId);
		const canonicalSession =
			canonicalSessionIdentity && canonicalSessionMetadata
				? sessionColdFromSlices(canonicalSessionIdentity, canonicalSessionMetadata)
				: undefined;
		const preservedSession = canonicalSession ?? aliasSession;
		const now = new Date();
		const nextSessionLifecycleState =
			snapshot.sourcePath !== null
				? "persisted"
				: (preservedSession?.sessionLifecycleState ?? "created");

		if (aliasSession && requestedSessionId !== canonicalSessionId) {
			this.#deps.removeSession(requestedSessionId);
		}

		const snapshotSession = sessionColdFromOpenSnapshotInput({
			id: canonicalSessionId,
			projectPath: snapshot.projectPath,
			agentId: canonicalAgentIdToString(snapshot.agentId),
			worktreePath: snapshot.worktreePath ?? undefined,
			title: snapshot.sessionTitle,
			updatedAt: preservedSession?.updatedAt ?? now,
			createdAt: preservedSession?.createdAt ?? now,
			sourcePath: snapshot.sourcePath ?? undefined,
			sessionLifecycleState: nextSessionLifecycleState,
			parentId: preservedSession?.parentId ?? null,
			sequenceId: snapshot.sequenceId ?? null,
			preservedMetadata: preservedSession,
		});

		if (canonicalSession) {
			this.#deps.listState.applyOpenSnapshotToList(canonicalSession, snapshotSession);
		} else {
			this.#deps.addSession(snapshotSession);
		}

		this.#deps.replaceSessionOperations(canonicalSessionId, snapshot.operations);
		this.#deps.replaceTranscriptSnapshot(
			canonicalSessionId,
			snapshot.transcriptSnapshot,
			now
		);
		this.#deps.initializeTransientProjection(canonicalSessionId);
		const graph = materializeSnapshotFromOpenFound(snapshot).graph;
		seedTranscriptEntryIndex(graph.transcriptSnapshot.entries);
		this.#deps.setSessionStateGraph(canonicalSessionId, graph);
		const canonicalCapabilities = sanitizeCanonicalCapabilities(graph.capabilities);
		this.#deps.setCapabilitiesMaterialized(canonicalSessionId, true);
		this.#deps.updateTransientProjection(canonicalSessionId, {
			statusChangedAt: Date.now(),
			capabilityMutationState: {
				pendingMutationId: null,
				previewState: deriveCapabilityPreviewState(canonicalCapabilities),
			},
		});
		const preservedStreamingState = preserveCanonicalStreamingState(
			this.#deps.getCanonicalProjection(canonicalSessionId)
		);
		this.#deps.setCanonicalProjection(canonicalSessionId, {
			lifecycle: graph.lifecycle,
			activity: graph.activity,
			turnState: snapshot.turnState,
			activeTurnFailure: mapProjectionTurnFailure(snapshot.activeTurnFailure ?? null),
			lastTerminalTurnId: snapshot.lastTerminalTurnId ?? null,
			activeStreamingTail: graph.activeStreamingTail ?? null,
			capabilities: canonicalCapabilities,
			tokenStream: preservedStreamingState.tokenStream,
			clockAnchor: preservedStreamingState.clockAnchor,
			revision: graph.revision,
		});
		this.#deps.sendContentLoad(canonicalSessionId);
		this.#deps.sendContentLoaded(canonicalSessionId);
	}

	ensureSessionFromStateGraph(graph: SessionStateGraph): boolean {
		const sessionId = graph.canonicalSessionId;
		if (graph.isAlias && graph.requestedSessionId !== graph.canonicalSessionId) {
			this.#deps.recordAliasRelationship(graph.requestedSessionId, graph.canonicalSessionId);
			this.#deps.migratePendingSendIntentAlias(
				graph.requestedSessionId,
				graph.canonicalSessionId
			);
		}
		if (this.#deps.getSessionIdentity(sessionId)) {
			this.syncSessionSequenceFromGraph(graph);
			this.#deps.creationCoordinator.completePendingCreation(sessionId);
			if (graph.isAlias) {
				this.#deps.creationCoordinator.completePendingCreation(graph.requestedSessionId);
			}
			return true;
		}

		const pendingCreation =
			this.#deps.creationCoordinator.getPendingCreation(sessionId) ??
			(graph.isAlias
				? this.#deps.creationCoordinator.getPendingCreation(graph.requestedSessionId)
				: null);
		if (pendingCreation === null) {
			return false;
		}

		const now = new Date();
		this.#deps.addSession({
			id: sessionId,
			projectPath: graph.projectPath,
			agentId: canonicalAgentIdToString(graph.agentId),
			worktreePath: graph.worktreePath ?? undefined,
			title: pendingCreation.title ?? "New Thread",
			updatedAt: now,
			createdAt: now,
			sourcePath: graph.sourcePath ?? undefined,
			sequenceId: graph.sequenceId ?? pendingCreation.sequenceId ?? undefined,
			sessionLifecycleState: graph.sourcePath ? "persisted" : "created",
			parentId: null,
		});
		this.#deps.creationCoordinator.completePendingCreation(sessionId);
		if (graph.isAlias) {
			this.#deps.creationCoordinator.completePendingCreation(graph.requestedSessionId);
		}
		return true;
	}

	syncSessionSequenceFromGraph(graph: SessionStateGraph): void {
		if (graph.sequenceId === null || graph.sequenceId === undefined) {
			return;
		}
		const metadata = this.#deps.getSessionMetadata(graph.canonicalSessionId);
		if (metadata === undefined || metadata.sequenceId != null) {
			return;
		}
		this.#deps.updateSession(
			graph.canonicalSessionId,
			{
				sequenceId: graph.sequenceId,
			},
			{ touchUpdatedAt: false }
		);
	}
}

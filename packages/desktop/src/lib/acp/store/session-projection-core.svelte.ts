/**
 * SessionProjectionCore — owns the per-session canonical projection state of the
 * session store (see docs/adr/0002): the `CanonicalSessionProjection` map, the
 * `SessionStateGraph` map, the capabilities-materialized flags, and the
 * row-token-stream index. Exposes the pure read selectors over that state.
 *
 * GOD note: these maps are the TypeScript projection of Rust-owned
 * `SessionStateGraph` truth, fed by the envelope dispatch loop (the canonical
 * *write spine*, which remains in SessionStore and writes through these maps).
 * This sub-store is the single owner of the projection maps; selectors are pure
 * canonical reads — no `canonical ?? hot` fallback, no provider branching, no
 * transcript-order repair.
 */
import { SvelteMap } from "svelte/reactivity";
import type {
	FailureReason,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
	SessionTurnState,
	TranscriptEntry,
} from "../../services/acp-types.js";
import type { ActiveTurnFailure } from "../types/turn-error.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import { mapProjectionTurnFailure } from "./envelope-reducer/projection-turn-failure.js";

function connectionErrorFromGraphState(
	lifecycle: SessionGraphLifecycle,
	activeTurnFailure: ActiveTurnFailure | null
): string | null {
	if (lifecycle.status === "failed") {
		return lifecycle.errorMessage ?? null;
	}

	if (activeTurnFailure !== null) {
		return null;
	}

	return null;
}

export class SessionProjectionCore {
	readonly canonicalProjections = new SvelteMap<string, CanonicalSessionProjection>();
	readonly sessionStateGraphs = new SvelteMap<string, SessionStateGraph>();
	readonly canonicalCapabilitiesMaterialized = new SvelteMap<string, boolean>();

	hasCanonicalProjection(sessionId: string): boolean {
		return this.canonicalProjections.has(sessionId);
	}

	getCanSend(sessionId: string): boolean | null {
		return this.canonicalProjections.get(sessionId)?.lifecycle.actionability.canSend ?? null;
	}

	getLifecycleStatus(sessionId: string): SessionGraphLifecycle["status"] | null {
		return this.canonicalProjections.get(sessionId)?.lifecycle.status ?? null;
	}

	getLifecycle(sessionId: string): SessionGraphLifecycle | null {
		return this.sessionStateGraphs.get(sessionId)?.lifecycle ?? null;
	}

	getActivity(sessionId: string): SessionGraphActivity | null {
		return this.sessionStateGraphs.get(sessionId)?.activity ?? null;
	}

	/** Canonical graph revision (null form, for the public selector). */
	getGraphRevisionOrNull(sessionId: string): SessionGraphRevision | null {
		return this.sessionStateGraphs.get(sessionId)?.revision ?? null;
	}

	/** Canonical graph revision (undefined form, for internal callers). */
	getGraphRevision(sessionId: string): SessionGraphRevision | undefined {
		return this.sessionStateGraphs.get(sessionId)?.revision;
	}

	getGraphTranscriptRevision(sessionId: string): number | undefined {
		return this.sessionStateGraphs.get(sessionId)?.transcriptSnapshot.revision;
	}

	/** Canonical turn state; null means no canonical graph exists yet. */
	getTurnState(sessionId: string): SessionTurnState | null {
		return this.sessionStateGraphs.get(sessionId)?.turnState ?? null;
	}

	/** Canonical message count; null means no canonical graph exists yet. */
	getMessageCount(sessionId: string): number | null {
		return this.sessionStateGraphs.get(sessionId)?.messageCount ?? null;
	}

	/** Canonical transcript entries; null means no canonical graph exists yet. */
	getTranscriptEntries(sessionId: string): ReadonlyArray<TranscriptEntry> | null {
		return this.sessionStateGraphs.get(sessionId)?.transcriptSnapshot.entries ?? null;
	}

	getLastTerminalTurnId(sessionId: string): string | null {
		return this.sessionStateGraphs.get(sessionId)?.lastTerminalTurnId ?? null;
	}

	getSessionStateGraph(sessionId: string): SessionStateGraph | null {
		return this.sessionStateGraphs.get(sessionId) ?? null;
	}

	getSessionConnectionError(sessionId: string): string | null {
		const graph = this.getSessionStateGraph(sessionId);
		if (graph === null) {
			return null;
		}
		return connectionErrorFromGraphState(
			graph.lifecycle,
			mapProjectionTurnFailure(graph.activeTurnFailure ?? null)
		);
	}

	getSessionLifecycleFailureReason(sessionId: string): FailureReason | null {
		const lifecycle = this.getSessionStateGraph(sessionId)?.lifecycle ?? null;
		if (lifecycle === null) {
			return null;
		}
		if (lifecycle.status !== "failed" && lifecycle.status !== "detached") {
			return null;
		}
		return lifecycle.failureReason ?? null;
	}

	getSessionLifecycleDetachedReason(
		sessionId: string
	): import("$lib/services/acp-types.js").DetachedReason | null {
		const lifecycle = this.getSessionStateGraph(sessionId)?.lifecycle ?? null;
		if (lifecycle === null || lifecycle.status !== "detached") {
			return null;
		}
		return lifecycle.detachedReason ?? null;
	}

	getSessionActiveTurnFailure(sessionId: string): ActiveTurnFailure | null {
		return mapProjectionTurnFailure(
			this.getSessionStateGraph(sessionId)?.activeTurnFailure ?? null
		);
	}
}

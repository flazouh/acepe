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
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
	SessionTurnState,
	TranscriptEntry,
} from "../../services/acp-types.js";
import type {
	CanonicalSessionProjection,
	RowTokenStream,
	SessionClockAnchor,
} from "./canonical-session-projection.js";
import { buildRowTokenStreamKey } from "./transcript-delta.js";

export class SessionProjectionCore {
	readonly canonicalProjections = new SvelteMap<string, CanonicalSessionProjection>();
	readonly sessionStateGraphs = new SvelteMap<string, SessionStateGraph>();
	readonly canonicalCapabilitiesMaterialized = new SvelteMap<string, boolean>();
	readonly rowTokenStreamsByRowId = new Map<string, Map<string, RowTokenStream>>();

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

	getActiveStreamingTailRowId(sessionId: string): string | null {
		return this.canonicalProjections.get(sessionId)?.activeStreamingTail?.rowId ?? null;
	}

	getClockAnchor(sessionId: string): SessionClockAnchor | null {
		return this.canonicalProjections.get(sessionId)?.clockAnchor ?? null;
	}

	getRowTokenStream(sessionId: string, turnId: string, rowId: string): RowTokenStream | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		if (projection === null) {
			return null;
		}
		return projection.tokenStream.get(buildRowTokenStreamKey(turnId, rowId)) ?? null;
	}

	getRowTokenStreamByRowId(sessionId: string, rowId: string): RowTokenStream | null {
		const projection = this.canonicalProjections.get(sessionId) ?? null;
		if (projection === null) {
			return null;
		}
		return this.rowTokenStreamsByRowId.get(sessionId)?.get(rowId) ?? null;
	}
}

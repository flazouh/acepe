/**
 * Reads one ephemeral ship-card turn off the canonical session-state lane.
 *
 * The ship card runs a hidden session and needs two facts back: the assistant
 * text as it streams, and whether the turn ended well. Both are canonical
 * `SessionStateEnvelope` data (see the GOD architecture check), so this module
 * is a pure fold over envelopes rather than a second event channel.
 */

import type {
	SessionStateEnvelope,
	TranscriptDeltaOperation,
	TranscriptEntry,
	TranscriptSnapshot,
	SessionTurnState,
} from "$lib/services/acp-types.js";

export type ShipTurnOutcome =
	| { readonly kind: "running" }
	| { readonly kind: "completed" }
	| { readonly kind: "failed"; readonly message: string };

export interface ShipTurnObserverState {
	readonly assistantText: string;
	readonly outcome: ShipTurnOutcome;
}

export const initialShipTurnObserverState: ShipTurnObserverState = {
	assistantText: "",
	outcome: { kind: "running" },
};

const DEFAULT_FAILURE_MESSAGE = "Agent turn failed";
const CANCELLED_MESSAGE = "Agent turn was cancelled";

function assistantTextInEntry(entry: TranscriptEntry): string {
	if (entry.role !== "assistant") {
		return "";
	}
	let text = "";
	for (const segment of entry.segments) {
		if (segment.kind === "text") {
			text += segment.text;
		}
	}
	return text;
}

function assistantTextInSnapshot(snapshot: TranscriptSnapshot): string {
	let text = "";
	for (const entry of snapshot.entries) {
		text += assistantTextInEntry(entry);
	}
	return text;
}

/**
 * Applies one transcript delta to the accumulated assistant text.
 *
 * `replaceSnapshot` replaces the whole transcript, so it replaces the
 * accumulation too rather than appending to it.
 */
function applyTranscriptOperations(
	accumulated: string,
	operations: readonly TranscriptDeltaOperation[]
): string {
	let text = accumulated;
	for (const operation of operations) {
		switch (operation.kind) {
			case "appendEntry":
				text += assistantTextInEntry(operation.entry);
				break;
			case "appendSegment":
				if (operation.role === "assistant" && operation.segment.kind === "text") {
					text += operation.segment.text;
				}
				break;
			case "replaceSnapshot":
				text = assistantTextInSnapshot(operation.snapshot);
				break;
			default:
				operation satisfies never;
		}
	}
	return text;
}

function outcomeForTurnState(
	turnState: SessionTurnState,
	failureMessage: string | null
): ShipTurnOutcome {
	switch (turnState) {
		case "Completed":
			return { kind: "completed" };
		case "Failed":
			return { kind: "failed", message: failureMessage ?? DEFAULT_FAILURE_MESSAGE };
		case "Cancelled":
			return { kind: "failed", message: CANCELLED_MESSAGE };
		case "Idle":
		case "Running":
			return { kind: "running" };
		default:
			turnState satisfies never;
			return { kind: "running" };
	}
}

/**
 * Folds one canonical envelope into the observed ship-card turn.
 *
 * Envelopes for any other session are ignored, so the shared session-state
 * stream can carry the whole app's traffic while this reads one turn.
 */
export function observeShipTurnEnvelope(
	state: ShipTurnObserverState,
	envelope: SessionStateEnvelope,
	sessionId: string
): ShipTurnObserverState {
	if (envelope.sessionId !== sessionId) {
		return state;
	}

	if (envelope.payload.kind === "snapshot") {
		const graph = envelope.payload.graph;
		return {
			assistantText: assistantTextInSnapshot(graph.transcriptSnapshot),
			outcome: outcomeForTurnState(graph.turnState, graph.activeTurnFailure?.message ?? null),
		};
	}

	if (envelope.payload.kind !== "delta") {
		return state;
	}

	const delta = envelope.payload.delta;
	return {
		assistantText: applyTranscriptOperations(state.assistantText, delta.transcriptOperations),
		outcome: outcomeForTurnState(delta.turnState, delta.activeTurnFailure?.message ?? null),
	};
}

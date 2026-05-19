import type { SessionTurnState } from "../../services/acp-types.js";
import type { TurnState } from "./types.js";

/**
 * Map the canonical session-graph turn state to the presentation status union.
 * This is display-only mapping; canonical turn state remains the source of truth.
 */
export function mapCanonicalTurnStateToPresentationStatus(turnState: SessionTurnState): TurnState {
	switch (turnState) {
		case "Idle":
			return "idle";
		case "Running":
			return "streaming";
		case "Completed":
			return "completed";
		case "Failed":
			return "error";
		case "Cancelled":
			return "interrupted";
	}
}

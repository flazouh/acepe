import type { SessionTurnState } from "../../services/acp-types.js";
import type { TurnState } from "./types.js";

/**
 * Map the canonical session-graph turn state to the legacy hot-state union.
 * Hot state remains a pre-canonical sentinel only.
 */
export function mapCanonicalTurnStateToHotTurnState(turnState: SessionTurnState): TurnState {
	switch (turnState) {
		case "Idle":
			return "idle";
		case "Running":
			return "streaming";
		case "Completed":
			return "completed";
		case "Failed":
			return "error";
	}
}

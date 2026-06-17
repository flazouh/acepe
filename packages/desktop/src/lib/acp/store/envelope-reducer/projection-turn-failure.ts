import type { TurnFailureSnapshot } from "../../../services/acp-types.js";
import type { ActiveTurnFailure } from "../../types/turn-error.js";

type ProjectionTurnFailure = TurnFailureSnapshot;

export function mapProjectionTurnFailure(
	failure: ProjectionTurnFailure | null | undefined
): ActiveTurnFailure | null {
	if (failure == null) {
		return null;
	}

	return {
		turnId: failure.turn_id ?? null,
		message: failure.message,
		code: failure.code ?? null,
		kind: failure.kind,
		source: failure.source ?? "unknown",
	};
}

import { mapCanonicalTurnStateToPresentationStatus } from "../../../store/canonical-turn-state-mapping.js";
import type { LiveSessionWorkSource } from "../../../store/live-session-work.js";
import type { SessionWorkProjection } from "../../../store/session-work-projection.js";
import type { TurnState } from "../../../store/types.js";

export interface AgentPanelContentRuntimeInput {
	readonly liveSessionSource: LiveSessionWorkSource;
	readonly explicitWaiting: boolean | undefined;
	readonly sessionWorkProjection: Pick<SessionWorkProjection, "canonicalActivity"> | null;
}

export interface AgentPanelContentRuntime {
	readonly turnState: TurnState;
	readonly isStreaming: boolean;
	readonly isWaitingForResponse: boolean;
}

export function resolveAgentPanelContentRuntime(
	input: AgentPanelContentRuntimeInput
): AgentPanelContentRuntime {
	const turnState = resolveTurnState(input.liveSessionSource);
	return {
		turnState,
		isStreaming: turnState === "streaming",
		isWaitingForResponse:
			input.explicitWaiting ?? input.sessionWorkProjection?.canonicalActivity === "awaiting_model",
	};
}

function resolveTurnState(source: LiveSessionWorkSource): TurnState {
	if (source.kind === "missing_canonical") {
		return "error";
	}

	if (source.kind !== "canonical") {
		return "idle";
	}

	return mapCanonicalTurnStateToPresentationStatus(source.projection.turnState);
}

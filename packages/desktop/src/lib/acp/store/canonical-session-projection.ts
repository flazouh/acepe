import type {
	ActiveStreamingTail,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionTurnState,
} from "../../services/acp-types.js";
import type { ActiveTurnFailure } from "../types/turn-error.js";

export type CanonicalSessionProjection = {
	readonly lifecycle: SessionGraphLifecycle;
	readonly activity: SessionGraphActivity;
	readonly turnState: SessionTurnState;
	readonly activeTurnFailure: ActiveTurnFailure | null;
	readonly lastTerminalTurnId: string | null;
	readonly activeStreamingTail: ActiveStreamingTail | null;
	readonly capabilities: SessionGraphCapabilities;
	readonly revision: SessionGraphRevision;
};

/**
 * The same projection at a new revision, carrying different capabilities. The
 * projection counterpart of `graphWithCapabilities` in session-graph-builders
 * .ts, so a reducer that changes capabilities says which fields it changes
 * instead of restating every field it does not.
 */
export function projectionWithCapabilities(
	projection: CanonicalSessionProjection,
	capabilities: SessionGraphCapabilities,
	revision: SessionGraphRevision
): CanonicalSessionProjection {
	return {
		lifecycle: projection.lifecycle,
		activity: projection.activity,
		turnState: projection.turnState,
		activeTurnFailure: projection.activeTurnFailure,
		lastTerminalTurnId: projection.lastTerminalTurnId,
		activeStreamingTail: projection.activeStreamingTail,
		capabilities,
		revision,
	};
}

import type {
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
	readonly capabilities: SessionGraphCapabilities;
	readonly revision: SessionGraphRevision;
};

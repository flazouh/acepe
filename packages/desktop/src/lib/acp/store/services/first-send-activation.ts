import type { SessionGraphLifecycle } from "../../../services/acp-types.js";
import type { SessionCold, SessionTransientProjection } from "../types.js";

export function canActivateCreatedSessionWithFirstPrompt(input: {
	readonly session: SessionCold;
	readonly hotState: SessionTransientProjection;
	readonly lifecycleStatus: SessionGraphLifecycle["status"] | null;
}): boolean {
	return (
		input.session.sessionLifecycleState === "created" &&
		!input.session.sourcePath &&
		(input.lifecycleStatus === "reserved" || input.lifecycleStatus === null) &&
		!input.hotState.isConnected
	);
}

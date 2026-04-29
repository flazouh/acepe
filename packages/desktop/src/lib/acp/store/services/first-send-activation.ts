import type { SessionGraphLifecycle } from "../../../services/acp-types.js";
import type { SessionCold } from "../types.js";

export function canActivateCreatedSessionWithFirstPrompt(input: {
	readonly session: SessionCold;
	readonly lifecycleStatus: SessionGraphLifecycle["status"] | null;
}): boolean {
	if (!isCreatedSessionWithoutSource(input.session)) {
		return false;
	}

	return input.lifecycleStatus === "reserved";
}

export function isPreCanonicalCreatedSession(input: {
	readonly session: SessionCold;
	readonly lifecycleStatus: SessionGraphLifecycle["status"] | null;
}): boolean {
	return (
		isCreatedSessionWithoutSource(input.session) && input.lifecycleStatus === null
	);
}

function isCreatedSessionWithoutSource(session: SessionCold): boolean {
	return session.sessionLifecycleState === "created" && !session.sourcePath;
}

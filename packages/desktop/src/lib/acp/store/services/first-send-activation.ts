import type { SessionGraphLifecycle } from "../../../services/acp-types.js";
import type { SessionMetadata } from "../types.js";

export function canActivateCreatedSessionWithFirstPrompt(input: {
	readonly sessionMetadata: SessionMetadata;
	readonly lifecycleStatus: SessionGraphLifecycle["status"] | null;
}): boolean {
	if (!isCreatedSessionWithoutSource(input.sessionMetadata)) {
		return false;
	}

	return input.lifecycleStatus === "reserved";
}

function isCreatedSessionWithoutSource(sessionMetadata: SessionMetadata): boolean {
	return sessionMetadata.sessionLifecycleState === "created" && !sessionMetadata.sourcePath;
}

import type { SessionGraphLifecycle } from "../../../services/acp-types.js";
import type { SessionMetadata } from "../types.js";

export function canActivateCreatedSessionWithFirstPrompt(input: {
	readonly sessionMetadata: SessionMetadata;
	readonly lifecycleStatus: SessionGraphLifecycle["status"] | null;
}): boolean {
	if (!isCreatedSessionWithoutSource(input.sessionMetadata)) {
		return false;
	}

	// `null` means no SessionStateGraph has been established for this session
	// yet -- expected for a session materialized from a deferred creation's
	// first envelope, which can race ahead of the canonical lifecycle graph
	// (that envelope has no prior graph-revision baseline to apply against,
	// so it degrades to a refreshSnapshot no-op instead of setting a
	// lifecycle). A freshly `created`, source-less session with no graph yet
	// is, by construction, no further along than "reserved" -- the first
	// prompt must stay activatable through that gap, or it is silently
	// dropped instead of dispatched.
	return input.lifecycleStatus === "reserved" || input.lifecycleStatus === null;
}

function isCreatedSessionWithoutSource(sessionMetadata: SessionMetadata): boolean {
	return sessionMetadata.sessionLifecycleState === "created" && !sessionMetadata.sourcePath;
}

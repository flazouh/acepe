import type { FailureReason } from "$lib/services/acp-types.js";

/**
 * Curated user-facing copy for canonical lifecycle failures, keyed on the
 * canonical failure reason plus an already-resolved agent display name.
 *
 * Returns `null` for failure reasons whose default copy is the raw provider
 * text — callers fall back to `lifecycle.errorMessage` (or any caller-supplied
 * raw string) for those cases.
 *
 * Layer ownership (GOD): Rust owns the `FailureReason` taxonomy. TypeScript
 * owns the user-facing words. i18n later = a single keyed table here.
 */
export function failureCopy(
	agentDisplayName: string | null,
	failureReason: FailureReason
): string | null {
	if (failureReason === "sessionGoneUpstream") {
		return sessionGoneUpstreamCopy(agentDisplayName);
	}

	// `resumeFailed` and other reasons currently fall back to raw provider
	// text — we don't want to mask transient/transport faults with curated
	// copy that hides the underlying signal. Add curated copy here as needed.
	return null;
}

function sessionGoneUpstreamCopy(agentDisplayName: string | null): string {
	if (agentDisplayName) {
		return `This ${agentDisplayName} session is no longer available to reopen. Start a new session to continue.`;
	}

	return "This saved session is no longer available to reopen. Start a new session to continue.";
}

import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { TranscriptEntry } from "../../../../services/acp-types.js";

export interface CanonicalUserEntryPresence {
	readonly hasCanonicalUserEntry: boolean | null;
	readonly hasCanonicalMatchingPendingUserEntry: boolean | null;
}

export function deriveCanonicalUserEntryPresence(input: {
	readonly transcriptEntries: readonly TranscriptEntry[] | null;
	readonly pendingAttemptId: string | null;
}): CanonicalUserEntryPresence {
	if (input.transcriptEntries === null) {
		return {
			hasCanonicalUserEntry: null,
			hasCanonicalMatchingPendingUserEntry: null,
		};
	}

	return {
		hasCanonicalUserEntry: input.transcriptEntries.some((entry) => entry.role === "user"),
		hasCanonicalMatchingPendingUserEntry:
			input.pendingAttemptId === null
				? false
				: input.transcriptEntries.some(
						(entry) => entry.role === "user" && entry.attemptId === input.pendingAttemptId
					),
	};
}

export function resolveOptimisticUserEntryForGraph(input: {
	readonly panelPendingUserEntry: SessionEntry | null;
	readonly sessionPendingOptimisticEntry: SessionEntry | null;
	readonly hasCanonicalUserEntry: boolean | null;
	readonly hasCanonicalMatchingPendingUserEntry: boolean | null;
}): SessionEntry | null {
	if (input.hasCanonicalMatchingPendingUserEntry === true) {
		return null;
	}

	if (input.sessionPendingOptimisticEntry !== null) {
		return input.sessionPendingOptimisticEntry;
	}

	if (input.hasCanonicalUserEntry === true || input.hasCanonicalUserEntry === null) {
		return null;
	}

	return input.panelPendingUserEntry;
}

export function resolveVisibleEntryCount(input: {
	readonly canonicalEntryCount: number | null;
	readonly optimisticUserEntry: SessionEntry | null;
}): number | null {
	if (input.canonicalEntryCount === null) {
		return input.optimisticUserEntry === null ? null : 1;
	}

	if (input.canonicalEntryCount > 0) {
		return input.canonicalEntryCount;
	}

	return input.optimisticUserEntry === null ? 0 : 1;
}

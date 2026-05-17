import type { SessionEntry } from "../../../application/dto/session-entry.js";

export function resolveOptimisticUserEntryForGraph(input: {
	readonly panelPendingUserEntry: SessionEntry | null;
	readonly sessionPendingOptimisticEntry: SessionEntry | null;
	readonly hasCanonicalUserEntry: boolean;
	readonly hasCanonicalMatchingPendingUserEntry: boolean;
}): SessionEntry | null {
	if (input.hasCanonicalMatchingPendingUserEntry) {
		return null;
	}

	if (input.sessionPendingOptimisticEntry !== null) {
		return input.sessionPendingOptimisticEntry;
	}

	if (input.hasCanonicalUserEntry) {
		return null;
	}

	return input.panelPendingUserEntry;
}

export function resolveVisibleEntryCount(input: {
	readonly canonicalEntryCount: number;
	readonly optimisticUserEntry: SessionEntry | null;
}): number {
	if (input.canonicalEntryCount > 0) {
		return input.canonicalEntryCount;
	}

	return input.optimisticUserEntry === null ? 0 : 1;
}

import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type {
	TranscriptEntry,
	TranscriptViewportRow,
} from "../../../../services/acp-types.js";

export interface CanonicalUserEntryPresence {
	readonly hasCanonicalUserEntry: boolean | null;
	readonly hasCanonicalMatchingPendingUserEntry: boolean | null;
}

export function deriveCanonicalUserEntryPresence(input: {
	readonly transcriptEntries: readonly TranscriptEntry[] | null;
	readonly viewportRows?: readonly TranscriptViewportRow[];
	readonly pendingAttemptId: string | null;
}): CanonicalUserEntryPresence {
	if (input.transcriptEntries === null) {
		return {
			hasCanonicalUserEntry: null,
			hasCanonicalMatchingPendingUserEntry: null,
		};
	}

	const matchingPendingEntry =
		input.pendingAttemptId === null
			? null
			: (input.transcriptEntries.find(
					(entry) => entry.role === "user" && entry.attemptId === input.pendingAttemptId
				) ?? null);
	const matchingPendingEntryIsRenderable =
		matchingPendingEntry !== null &&
		(input.viewportRows === undefined ||
			input.viewportRows.some((row) => row.sourceEntryId === matchingPendingEntry.entryId));

	return {
		hasCanonicalUserEntry: input.transcriptEntries.some((entry) => entry.role === "user"),
		hasCanonicalMatchingPendingUserEntry: matchingPendingEntryIsRenderable,
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
	if (input.panelPendingUserEntry !== null) {
		return input.panelPendingUserEntry;
	}

	if (input.hasCanonicalUserEntry === true || input.hasCanonicalUserEntry === null) {
		return null;
	}

	return null;
}

export function resolveVisibleEntryCount(input: {
	readonly canonicalEntryCount: number | null;
	readonly canonicalMessageCount: number | null;
	readonly canonicalViewportRowCount?: number | null;
	readonly optimisticUserEntry: SessionEntry | null;
}): number | null {
	if (input.canonicalEntryCount === null) {
		if (input.canonicalMessageCount !== null && input.canonicalMessageCount > 0) {
			return input.canonicalMessageCount;
		}
		if (
			input.canonicalViewportRowCount !== null &&
			input.canonicalViewportRowCount !== undefined &&
			input.canonicalViewportRowCount > 0
		) {
			return input.canonicalViewportRowCount;
		}
		return input.optimisticUserEntry === null ? null : 1;
	}

	if (input.canonicalEntryCount > 0) {
		return input.canonicalEntryCount;
	}

	if (input.canonicalMessageCount !== null && input.canonicalMessageCount > 0) {
		return input.canonicalMessageCount;
	}

	if (
		input.canonicalViewportRowCount !== null &&
		input.canonicalViewportRowCount !== undefined &&
		input.canonicalViewportRowCount > 0
	) {
		return input.canonicalViewportRowCount;
	}

	return input.optimisticUserEntry === null ? 0 : 1;
}

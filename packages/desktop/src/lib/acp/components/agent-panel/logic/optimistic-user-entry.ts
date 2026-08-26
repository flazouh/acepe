import type { TranscriptEntry, TranscriptViewportRow } from "../../../../services/acp-types.js";
import type { SessionEntry } from "../../../application/dto/session-entry.js";
import { segmentText } from "../../../session-state/transcript-text.js";

export interface CanonicalUserEntryPresence {
	readonly hasCanonicalUserEntry: boolean | null;
	readonly hasCanonicalMatchingPendingUserEntry: boolean | null;
}

function findMatchingPendingUserEntry(
	transcriptEntries: readonly TranscriptEntry[],
	input: {
		readonly pendingAttemptId: string | null;
		readonly pendingUserText: string | null;
	}
): TranscriptEntry | null {
	if (input.pendingAttemptId !== null) {
		const byAttemptId = transcriptEntries.find(
			(entry) => entry.role === "user" && entry.attemptId === input.pendingAttemptId
		);
		if (byAttemptId !== undefined) {
			return byAttemptId;
		}
	}
	// AC-264: the live Electrobun bridge (orchestration-canonical-bridge.ts)
	// never stamps `attemptId` on the entry it appends, so attemptId matching
	// alone never succeeds for a live session -- the optimistic row would
	// then coexist with the canonical one until turn completion instead of
	// reconciling the moment the canonical row lands. Text content is a real,
	// already-available fact on both sides (the send-moment text and the
	// canonical entry's real segment text) and needs no new plumbing.
	if (input.pendingUserText !== null) {
		const byText = transcriptEntries.find(
			(entry) => entry.role === "user" && segmentText(entry) === input.pendingUserText
		);
		if (byText !== undefined) {
			return byText;
		}
	}
	return null;
}

export function deriveCanonicalUserEntryPresence(input: {
	readonly transcriptEntries: readonly TranscriptEntry[] | null;
	readonly viewportRows?: readonly TranscriptViewportRow[];
	readonly pendingAttemptId: string | null;
	readonly pendingUserText?: string | null;
}): CanonicalUserEntryPresence {
	if (input.transcriptEntries === null) {
		return {
			hasCanonicalUserEntry: null,
			hasCanonicalMatchingPendingUserEntry: null,
		};
	}

	const matchingPendingEntry = findMatchingPendingUserEntry(input.transcriptEntries, {
		pendingAttemptId: input.pendingAttemptId,
		pendingUserText: input.pendingUserText ?? null,
	});
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

/**
 * Electrobun stand-in for the Rust `transcript_projection` module: builds
 * {@link TranscriptViewportRow}s directly from the canonical
 * {@link TranscriptEntry} list already carried on `SessionStateGraph.
 * transcriptSnapshot` (see `session-projection-core.svelte.ts`'s
 * `getTranscriptEntries`).
 *
 * This is a real-data, entries-only mapper -- it does not interleave
 * `operations` (tool calls) into row order, because neither the live
 * orchestration events nor the entries they produce (see
 * `orchestration-canonical-bridge.ts`) carry a shared ordering key today.
 * Inventing an interleave order would be fabricated data, so tool-call rows
 * are left out of this mapper rather than guessed at. Text/thought
 * transcript content -- the bulk of what a session shows -- renders in its
 * real, already-correct append order.
 */
import type { TranscriptEntry, TranscriptViewportRow } from "../../services/acp-types.js";

function isAllThoughtSegments(entry: TranscriptEntry): boolean {
	return entry.segments.length > 0 && entry.segments.every((segment) => segment.kind === "thought");
}

function kindFromEntry(entry: TranscriptEntry): TranscriptViewportRow["kind"] {
	switch (entry.role) {
		case "user":
			return "user";
		case "assistant":
			return isAllThoughtSegments(entry) ? "assistantThought" : "assistantText";
		case "tool":
			return "tool";
		case "sessionActivity":
			return "sessionActivity";
	}
}

function contentFromEntry(entry: TranscriptEntry): TranscriptViewportRow["content"] {
	const compactionSegment = entry.segments.find((segment) => segment.kind === "compaction");
	if (compactionSegment !== undefined) {
		return { kind: "compaction", event: compactionSegment.event };
	}
	return { kind: "transcript", role: entry.role, segments: entry.segments };
}

function rowFromEntry(entry: TranscriptEntry): TranscriptViewportRow {
	return {
		rowId: entry.entryId,
		sourceEntryId: entry.entryId,
		scope: entry.scope,
		kind: kindFromEntry(entry),
		// Segment count is a real, monotonically-growing fact about this entry
		// (streamed tokens append segments), so it is a correct proxy for "did
		// the content change" -- see `renderKey` in transcript-rows-store.ts.
		version: String(entry.segments.length),
		anchorEligible: entry.role === "user",
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: contentFromEntry(entry),
		timestampMs: entry.timestampMs ?? null,
	};
}

/**
 * Project viewport rows from the canonical transcript entries. Input order
 * is display order -- this never re-sorts.
 */
export function transcriptViewportRowsFromEntries(
	entries: ReadonlyArray<TranscriptEntry>
): TranscriptViewportRow[] {
	return entries.map(rowFromEntry);
}

/**
 * Electrobun stand-in for the Rust `transcript_projection` module: builds
 * {@link TranscriptViewportRow}s directly from the canonical
 * {@link TranscriptEntry} list already carried on `SessionStateGraph.
 * transcriptSnapshot` (see `session-projection-core.svelte.ts`'s
 * `getTranscriptEntries`).
 *
 * AC-263: tool calls now DO have a shared ordering key with the rest of the
 * transcript -- `orchestration-canonical-bridge.ts` appends a `role: "tool"`
 * TranscriptEntry (and `reopen-snapshot-graph.ts` seeds one per historical
 * activity) at the same real arrival position other entries occupy, so a
 * row's position in `entries` is already correct display order; nothing
 * here re-sorts. What was still missing is the operation data a "tool" row
 * needs to render (title/status/path): each `role: "tool"` entry is
 * resolved against the canonical `operations` array via the same
 * `source_link.kind === "transcript_linked"` index `operation-index.ts`
 * already builds for the (currently unused-in-prod) graph materializer --
 * reused here rather than re-implemented, so both call sites agree on what
 * "linked" means.
 */
import type {
	ActiveStreamingTail,
	OperationSnapshot,
	TranscriptEntry,
	TranscriptViewportOperationLink,
	TranscriptViewportRow,
} from "../../services/acp-types.js";
import {
	buildOperationIndex,
	findOperationForTranscriptSourceEntry,
	type OperationIndex,
} from "./operation-index.js";

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

function operationLinkFor(
	entry: TranscriptEntry,
	index: OperationIndex | null
): TranscriptViewportOperationLink[] {
	if (entry.role !== "tool" || index === null) {
		return [];
	}
	const operation = findOperationForTranscriptSourceEntry(entry.entryId, index);
	if (operation === null) {
		return [];
	}
	return [
		{
			operationId: operation.id,
			toolCallId: operation.tool_call_id,
			name: operation.name,
			state: operation.operation_state,
			operation,
		},
	];
}

function rowFromEntry(
	entry: TranscriptEntry,
	index: OperationIndex | null,
	liveTail: ActiveStreamingTail | null
): TranscriptViewportRow {
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
		// The graph names ONE row as the live streaming tail; the row mapper's
		// `isStreaming: row.activeStreamingTail !== null` and every reveal mode
		// downstream hang off this. Hardcoding null here was the live defect
		// that made fade + reveal render as "instant" for whole replies.
		activeStreamingTail:
			liveTail !== null && liveTail.rowId === entry.entryId ? liveTail.contentKind : null,
		operationLinks: operationLinkFor(entry, index),
		interactionLinks: [],
		content: contentFromEntry(entry),
		timestampMs: entry.timestampMs ?? null,
	};
}

/**
 * Project viewport rows from the canonical transcript entries. Input order
 * is display order -- this never re-sorts. `operations` is the canonical
 * operation graph (`SessionStateGraph.operations`); passing it lets `role:
 * "tool"` entries resolve to a real `operationLinks` entry so the row
 * renders title/status/path. Non-tool callers, and callers with no
 * operations yet, may omit it.
 */
export function transcriptViewportRowsFromEntries(
	entries: ReadonlyArray<TranscriptEntry>,
	operations: ReadonlyArray<OperationSnapshot> = [],
	// The graph's activeStreamingTail, already gated by the caller to a
	// Running turn (conversation-rebuild applies the same gate). Omit for
	// historical or idle projections and no row is marked.
	liveTail: ActiveStreamingTail | null = null
): TranscriptViewportRow[] {
	// Building the index once per call, not per entry, keeps this
	// O(entries + operations) instead of O(entries * operations).
	const index = operations.length === 0 ? null : buildOperationIndex(operations);
	return entries.map((entry) => rowFromEntry(entry, index, liveTail));
}

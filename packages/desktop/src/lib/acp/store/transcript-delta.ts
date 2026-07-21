/**
 * Transcript-delta helpers for the session store: apply a streaming
 * transcript delta to a snapshot (append/replace entries). Pure transforms
 * over transcript snapshots; reuses the transcript-entry index helpers.
 * GOD-safe.
 */
import type { TranscriptDelta, TranscriptSnapshot } from "../../services/acp-types.js";
import {
	appendTranscriptSegment,
	replaceTranscriptEntry,
	seedTranscriptEntryIndex,
} from "./transcript-entry-index.js";

export function applyTranscriptDeltaToSnapshot(
	snapshot: TranscriptSnapshot,
	delta: TranscriptDelta
): TranscriptSnapshot {
	let entries = snapshot.entries;

	for (const operation of delta.operations) {
		if (operation.kind === "replaceSnapshot") {
			entries = operation.snapshot.entries;
			seedTranscriptEntryIndex(entries);
			continue;
		}

		if (operation.kind === "appendEntry") {
			entries = replaceTranscriptEntry(entries, operation.entry);
			continue;
		}

		entries = appendTranscriptSegment(
			entries,
			operation.entryId,
			operation.role,
			operation.segment
		);
	}

	return {
		revision: delta.snapshotRevision,
		entries,
	};
}

/**
 * Transcript-delta + row-token-stream helpers for the session store: apply a
 * streaming transcript delta to a snapshot (append/replace entries) and the
 * row-token-stream map utilities + appended-word counting. Pure transforms over
 * transcript snapshots; reuses the transcript-entry index helpers. GOD-safe.
 */
import type { TranscriptDelta, TranscriptEntry, TranscriptSnapshot } from "../../services/acp-types.js";
import { countWordsInMarkdown } from "@acepe/ui/markdown";
import type { RowTokenStream } from "./canonical-session-projection.js";
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

export function buildRowTokenStreamKey(turnId: string, rowId: string): string {
	return `${turnId}:${rowId}`;
}

export function cloneRowTokenStreamMap(
	tokenStream: ReadonlyMap<string, RowTokenStream>
): Map<string, RowTokenStream> {
	const nextTokenStream = new Map<string, RowTokenStream>();
	for (const [key, value] of tokenStream) {
		nextTokenStream.set(key, value);
	}
	return nextTokenStream;
}

export function countAppendedMarkdownWords(input: {
	readonly previousText: string;
	readonly previousWordCount: number;
	readonly deltaText: string;
}): {
	readonly wordCount: number;
	readonly latestWordCount: number;
} {
	const previousTailStart = findPreviousWordBoundary(input.previousText);
	const previousTail = input.previousText.slice(previousTailStart);
	const previousTailWordCount = countWordsInMarkdown(previousTail);
	const nextTailWordCount = countWordsInMarkdown(`${previousTail}${input.deltaText}`);
	return {
		wordCount: input.previousWordCount - previousTailWordCount + nextTailWordCount,
		latestWordCount: countWordsInMarkdown(input.deltaText),
	};
}

function findPreviousWordBoundary(text: string): number {
	for (let index = text.length - 1; index >= 0; index -= 1) {
		if (/\s/.test(text[index] ?? "")) {
			return index + 1;
		}
	}
	return 0;
}

export function emptyRowTokenStream(): ReadonlyMap<string, RowTokenStream> {
	return new Map<string, RowTokenStream>();
}


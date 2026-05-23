import type { TranscriptEntry } from "../../services/acp-types.js";

export type TranscriptEntryArrayPatch = {
	readonly baseEntries: readonly TranscriptEntry[];
	readonly patchedEntriesByIndex: ReadonlyMap<number, TranscriptEntry> | null;
	readonly appendedEntries: readonly TranscriptEntry[] | null;
};

const transcriptEntryArrayPatches = new WeakMap<
	readonly TranscriptEntry[],
	TranscriptEntryArrayPatch
>();

export function markTranscriptEntryArrayPatch(
	entries: readonly TranscriptEntry[],
	patch: TranscriptEntryArrayPatch
): void {
	transcriptEntryArrayPatches.set(entries, patch);
}

export function getTranscriptEntryArrayPatch(
	entries: readonly TranscriptEntry[]
): TranscriptEntryArrayPatch | undefined {
	return transcriptEntryArrayPatches.get(entries);
}

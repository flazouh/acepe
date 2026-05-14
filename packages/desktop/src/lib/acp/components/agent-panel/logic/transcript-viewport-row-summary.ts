export type TranscriptViewportChangedRange = {
	startIndex: number;
	endIndex: number;
};

export type TranscriptViewportRowsReason =
	| "initial"
	| "waiting-row-appended"
	| "streaming-growth"
	| "session-switch"
	| "rows-updated";

export type TranscriptViewportRowSummary = {
	version: number;
	count: number;
	firstKey: string | null;
	lastKey: string | null;
	latestUserKey: string | null;
	anchorEligibleKeys: readonly string[];
	changedRange?: TranscriptViewportChangedRange;
	reason?: TranscriptViewportRowsReason;
};

export function createEmptyTranscriptViewportRows(): TranscriptViewportRowSummary {
	return {
		version: 0,
		count: 0,
		firstKey: null,
		lastKey: null,
		latestUserKey: null,
		anchorEligibleKeys: [],
	};
}

export type TranscriptViewportDiagnosticRecord = {
	schemaVersion: 1;
	sessionId: string | null;
	generation: number;
	eventType: string;
	follow: "following" | "detached";
	renderer: string;
	anchor: string;
	rowCount: number;
	effectTypes: readonly string[];
};

export type TranscriptViewportDiagnostics = {
	limit: number;
	records: readonly TranscriptViewportDiagnosticRecord[];
};

export function createTranscriptViewportDiagnostics(options: {
	limit: number;
}): TranscriptViewportDiagnostics {
	return {
		limit: options.limit,
		records: [],
	};
}

export function recordTranscriptViewportDiagnostic(
	diagnostics: TranscriptViewportDiagnostics,
	record: TranscriptViewportDiagnosticRecord
): TranscriptViewportDiagnostics {
	const records = diagnostics.records.concat(record);
	const startIndex = Math.max(0, records.length - diagnostics.limit);
	return {
		limit: diagnostics.limit,
		records: records.slice(startIndex),
	};
}

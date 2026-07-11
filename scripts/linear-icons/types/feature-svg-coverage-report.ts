import type { FeatureSvgCoverageRow } from "./feature-svg-coverage-row.js";

export type FeatureSvgCoverageReport = {
	readonly schemaVersion: 2;
	readonly corpusHash: string;
	readonly reportHash: string;
	readonly complete: boolean;
	readonly stats: {
		readonly decodedEntries: number;
		readonly javascriptEntries: number;
		readonly candidates: number;
		readonly extracted: number;
		readonly excluded: number;
		readonly needsReview: number;
	};
	readonly candidates: readonly FeatureSvgCoverageRow[];
};

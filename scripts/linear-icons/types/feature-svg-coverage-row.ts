export type FeatureSvgCoverageRow = {
	readonly candidateId: string;
	readonly assetName: string;
	readonly ownerName: string | null;
	readonly sourceStart: number;
	readonly sourceEnd: number;
	readonly sourceFingerprint: string;
	readonly geometryHash: string | null;
	readonly status: "extracted" | "excluded" | "needs-review";
	readonly reason:
		| "recognized-extraction-path"
		| "explicit-non-icon-viewbox"
		| "svg-wrapper-without-owned-geometry"
		| "runtime-generated-visualization"
		| "missing-semantic-evidence";
};

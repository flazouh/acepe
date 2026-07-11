export type FeatureSvgCandidate = {
	readonly assetName: string;
	readonly ownerName: string | null;
	readonly sourceStart: number;
	readonly sourceEnd: number;
	readonly sourceFingerprint: string;
	readonly status: "candidate";
};

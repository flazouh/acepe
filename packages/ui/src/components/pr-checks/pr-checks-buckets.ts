import type { PrChecksItem, PrChecksItemConclusion } from "./types.js";

export type CheckBucket = "failure" | "in_progress" | "neutral" | "success";

export interface CheckBucketCounts {
	readonly failure: number;
	readonly inProgress: number;
	readonly neutral: number;
	readonly success: number;
}

function isNeutralConclusion(conclusion: PrChecksItemConclusion | null): boolean {
	return (
		conclusion === "NEUTRAL" ||
		conclusion === "CANCELLED" ||
		conclusion === "SKIPPED" ||
		conclusion === "STALE" ||
		conclusion === "UNKNOWN"
	);
}

function isFailureConclusion(conclusion: PrChecksItemConclusion | null): boolean {
	return (
		conclusion === "FAILURE" ||
		conclusion === "TIMED_OUT" ||
		conclusion === "ACTION_REQUIRED" ||
		conclusion === "STARTUP_FAILURE"
	);
}

export function bucketOfCheck(check: PrChecksItem): CheckBucket {
	if (check.status !== "COMPLETED") return "in_progress";
	if (isFailureConclusion(check.conclusion)) return "failure";
	if (isNeutralConclusion(check.conclusion)) return "neutral";
	return "success";
}

export function countCheckBuckets(checks: readonly PrChecksItem[]): CheckBucketCounts {
	let failure = 0;
	let inProgress = 0;
	let neutral = 0;
	let success = 0;
	for (const check of checks) {
		switch (bucketOfCheck(check)) {
			case "failure":
				failure += 1;
				break;
			case "in_progress":
				inProgress += 1;
				break;
			case "neutral":
				neutral += 1;
				break;
			case "success":
				success += 1;
				break;
		}
	}
	return { failure, inProgress, neutral, success };
}

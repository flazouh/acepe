import type { CheckBucket, CheckBucketCounts } from "./pr-checks-buckets.js";

export type PrChecksSummarySegmentKind = CheckBucket;

export interface PrChecksSummarySegment {
	readonly kind: PrChecksSummarySegmentKind;
	readonly count: number;
	readonly label: string;
}

function bucketLabel(kind: CheckBucket, count: number): string {
	switch (kind) {
		case "failure":
			return `${count} failed`;
		case "in_progress":
			return `${count} running`;
		case "neutral":
			return `${count} neutral`;
		case "success":
			return `${count} passed`;
	}
}

export function buildPrChecksSummarySegments(
	counts: CheckBucketCounts
): readonly PrChecksSummarySegment[] {
	const segments: PrChecksSummarySegment[] = [];
	if (counts.failure > 0) {
		segments.push({
			kind: "failure",
			count: counts.failure,
			label: bucketLabel("failure", counts.failure),
		});
	}
	if (counts.inProgress > 0) {
		segments.push({
			kind: "in_progress",
			count: counts.inProgress,
			label: bucketLabel("in_progress", counts.inProgress),
		});
	}
	if (counts.neutral > 0) {
		segments.push({
			kind: "neutral",
			count: counts.neutral,
			label: bucketLabel("neutral", counts.neutral),
		});
	}
	if (counts.success > 0) {
		segments.push({
			kind: "success",
			count: counts.success,
			label: bucketLabel("success", counts.success),
		});
	}
	return segments;
}

export function formatPrChecksSummaryAriaLabel(
	counts: CheckBucketCounts,
	total: number
): string {
	const segments = buildPrChecksSummarySegments(counts);
	if (total === 0) {
		return "No checks";
	}

	const checkWord = total === 1 ? "check" : "checks";

	if (segments.length === 0) {
		return `${total} ${checkWord}`;
	}

	if (segments.length === 1 && segments[0].count === total) {
		const kind = segments[0].kind;
		if (kind === "failure") {
			return `${total} ${checkWord} failed`;
		}
		if (kind === "in_progress") {
			return `${total} ${checkWord} running`;
		}
		if (kind === "neutral") {
			return `${total} ${checkWord} completed with neutral status`;
		}
		return `${total} ${checkWord} passed`;
	}

	if (counts.failure > 0) {
		const parts: string[] = [`${counts.failure} of ${total} failed`];
		for (const segment of segments) {
			if (segment.kind !== "failure") {
				parts.push(segment.label);
			}
		}
		return parts.join(", ");
	}

	return segments.map((segment) => segment.label).join(", ");
}

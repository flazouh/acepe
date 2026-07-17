import {
	selectSessionWorkBucket,
	type SessionWorkProjection,
} from "../session-work-projection.js";

/**
 * Attention kinds that solicit the user when a project group is collapsed.
 * Working/planning buckets are excluded — those are still in progress.
 */
export type AttentionKind = "answer_needed" | "needs_review" | "error";

export interface SessionAttentionEntry {
	readonly kind: AttentionKind;
	readonly panelId: string;
}

export function selectAttentionKind(
	projection: SessionWorkProjection
): AttentionKind | null {
	const bucket = selectSessionWorkBucket(projection);
	if (bucket === "answer_needed" || bucket === "needs_review" || bucket === "error") {
		return bucket;
	}
	return null;
}

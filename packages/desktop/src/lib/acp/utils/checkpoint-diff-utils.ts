/**
 * Utilities for computing diff statistics from checkpoints.
 */

import type { Checkpoint } from "../types/checkpoint.js";

/**
 * Calculate cumulative diff stats from checkpoints.
 * Returns null if no checkpoints or all checkpoints lack diff data.
 */
export function computeStatsFromCheckpoints(
	checkpoints: readonly Checkpoint[]
): { insertions: number; deletions: number } | null {
	if (checkpoints.length === 0) return null;

	let insertions = 0;
	let deletions = 0;
	let hasAnyStats = false;

	for (const cp of checkpoints) {
		if (cp.totalLinesAdded !== null) {
			insertions += cp.totalLinesAdded;
			hasAnyStats = true;
		}
		if (cp.totalLinesRemoved !== null) {
			deletions += cp.totalLinesRemoved;
			hasAnyStats = true;
		}
	}

	return hasAnyStats ? { insertions, deletions } : null;
}

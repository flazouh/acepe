import type { SessionGraphActivity } from "../../../services/acp-types.js";

export function mergeSessionGraphActivityTiming(
	previous: SessionGraphActivity,
	selected: SessionGraphActivity,
	nowMs: number
): SessionGraphActivity {
	const kindStartedAtMs =
		previous.kind === selected.kind
			? (previous.kindStartedAtMs ?? selected.kindStartedAtMs ?? null)
			: nowMs;

	return {
		kind: selected.kind,
		activeOperationCount: selected.activeOperationCount,
		activeSubagentCount: selected.activeSubagentCount,
		dominantOperationId: selected.dominantOperationId ?? null,
		blockingInteractionId: selected.blockingInteractionId ?? null,
		kindStartedAtMs: selected.kind === "idle" ? null : kindStartedAtMs,
	};
}

export function seedSessionGraphActivityTimingIfNeeded(
	activity: SessionGraphActivity,
	nowMs: number
): SessionGraphActivity {
	if (activity.kind === "idle" || activity.kindStartedAtMs != null) {
		return activity;
	}

	return {
		kind: activity.kind,
		activeOperationCount: activity.activeOperationCount,
		activeSubagentCount: activity.activeSubagentCount,
		dominantOperationId: activity.dominantOperationId ?? null,
		blockingInteractionId: activity.blockingInteractionId ?? null,
		kindStartedAtMs: nowMs,
	};
}

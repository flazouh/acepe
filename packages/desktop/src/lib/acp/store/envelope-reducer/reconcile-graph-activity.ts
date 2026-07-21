import type {
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionTurnState,
} from "../../../services/acp-types.js";
import type { ActiveTurnFailure } from "../../types/turn-error.js";
import {
	mergeSessionGraphActivityTiming,
	seedSessionGraphActivityTimingIfNeeded,
} from "./merge-session-graph-activity-timing.js";

function cloneSessionGraphActivity(activity: SessionGraphActivity): SessionGraphActivity {
	return {
		kind: activity.kind,
		activeOperationCount: activity.activeOperationCount,
		activeSubagentCount: activity.activeSubagentCount,
		dominantOperationId: activity.dominantOperationId ?? null,
		blockingInteractionId: activity.blockingInteractionId ?? null,
		kindStartedAtMs: activity.kindStartedAtMs ?? null,
	};
}

function emptySessionGraphActivity(kind: SessionGraphActivity["kind"]): SessionGraphActivity {
	return {
		kind,
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
		kindStartedAtMs: null,
	};
}

function deriveRecoveredActivityKind(
	activity: SessionGraphActivity,
	turnState: SessionTurnState
): SessionGraphActivity["kind"] {
	if (activity.blockingInteractionId != null) {
		return "waiting_for_user";
	}

	if (activity.activeOperationCount > 0) {
		return "running_operation";
	}

	if (turnState === "Running") {
		return "awaiting_model";
	}

	return "idle";
}

export function reconcileStoredGraphActivity(
	activity: SessionGraphActivity | null | undefined,
	lifecycle: SessionGraphLifecycle,
	turnState: SessionTurnState,
	activeTurnFailure: ActiveTurnFailure | null
): SessionGraphActivity | null {
	const previousActivity = activity ?? null;

	if (lifecycle.status === "failed" || activeTurnFailure !== null) {
		if (previousActivity === null) {
			return {
				kind: "error",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			};
		}

		return {
			kind: "error",
			activeOperationCount: previousActivity.activeOperationCount,
			activeSubagentCount: previousActivity.activeSubagentCount,
			dominantOperationId: previousActivity.dominantOperationId ?? null,
			blockingInteractionId: previousActivity.blockingInteractionId ?? null,
		};
	}

	if (previousActivity === null) {
		if (turnState === "Running") {
			return emptySessionGraphActivity("awaiting_model");
		}
		return null;
	}

	if (previousActivity.kind === "idle" && turnState === "Running") {
		return seedSessionGraphActivityTimingIfNeeded(
			emptySessionGraphActivity("awaiting_model"),
			Date.now()
		);
	}

	if (previousActivity.kind === "awaiting_model" && turnState !== "Running") {
		return emptySessionGraphActivity("idle");
	}

	if (previousActivity.kind !== "error") {
		return cloneSessionGraphActivity(previousActivity);
	}

	return seedSessionGraphActivityTimingIfNeeded(
		{
			kind: deriveRecoveredActivityKind(previousActivity, turnState),
			activeOperationCount: previousActivity.activeOperationCount,
			activeSubagentCount: previousActivity.activeSubagentCount,
			dominantOperationId: previousActivity.dominantOperationId ?? null,
			blockingInteractionId: previousActivity.blockingInteractionId ?? null,
			kindStartedAtMs: null,
		},
		Date.now()
	);
}

export function defaultIdleActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
		kindStartedAtMs: null,
	};
}

export { mergeSessionGraphActivityTiming, seedSessionGraphActivityTimingIfNeeded };
